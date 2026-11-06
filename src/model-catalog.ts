import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {authCommand} from './subscription-setup.ts';
import {subscriptionEnvironment} from './provider-config.ts';
import {SDK_PINS} from './sdk-execution.ts';
import {REASONING_LEVELS} from './reasoning.ts';
export type CatalogProvider='codex'|'claude';
export type ModelCatalog={provider:string;models:string[];labels:Record<string,string>;efforts?:Record<string,string[]>;total:number|null;truncated:boolean;omitted:number;source:string;availabilityVerified:false;inferencePerformed:false};
const valid=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)&&!['default','auto'].includes(value.toLowerCase());
export function normalizeCatalog(provider:CatalogProvider,rows:unknown,more=false):ModelCatalog {
 if(!Array.isArray(rows))throw Error('Invalid model catalog');
 const ids:string[]=[],labels:Record<string,string>={},efforts:Record<string,string[]>={};let omitted=0;
 for(const row of rows){
  if(!row||typeof row!=='object'){omitted++;continue;}
  const id=provider==='codex'?(row.model??row.id):(['default','auto'].includes(String(row.value).toLowerCase())?null:row.resolvedModel??row.value);
  if(!valid(id)){omitted++;continue;}if(ids.includes(id))continue;
  ids.push(id);if(ids.length<=200)labels[id]=typeof row.displayName==='string'?row.displayName.slice(0,160):id;
  const levels=provider==='codex'?row.supportedReasoningEfforts:row.supportedEffortLevels;
  if(ids.length<=200&&(Array.isArray(levels)||row.supportsEffort===false))efforts[id]=row.supportsEffort===false?[]:[...new Set((levels as unknown[]).map(value=>provider==='codex'&&value&&typeof value==='object'?(value as {reasoningEffort?:unknown}).reasoningEffort:value).filter((value):value is string=>typeof value==='string'&&REASONING_LEVELS[provider].includes(value)))];
 }
 return {provider,models:ids.slice(0,200),labels,...(Object.keys(efforts).length?{efforts}:{}),total:more?null:ids.length,truncated:more||ids.length>200,omitted,source:provider+'-cli-catalog',availabilityVerified:false,inferencePerformed:false};
}
export function catalogCommand(provider:CatalogProvider){
 const root=fileURLToPath(new URL('../node_modules/',import.meta.url));
 const pkg=provider==='codex'?'@openai/codex-sdk':'@anthropic-ai/claude-agent-sdk';
 if(JSON.parse(readFileSync(join(root,pkg,'package.json'),'utf8')).version!==SDK_PINS[provider])throw Error('Provider SDK version mismatch; restore dependencies');
 const cliPackage=provider==='codex'?'@openai/codex':`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
 if(JSON.parse(readFileSync(join(root,cliPackage,'package.json'),'utf8')).version!==SDK_PINS[provider])throw Error('Provider CLI package version mismatch; restore dependencies');
 const base=authCommand(provider,'status');
 return provider==='codex'?{file:base.file,args:[base.args[0],'-c','forced_login_method="chatgpt"','-c','model_provider="openai"','-c','mcp_servers={}','-c','project_doc_max_bytes=0','-c','features.apps=false','app-server','--listen','stdio://']}:
 {file:base.file,args:['-p','--output-format','stream-json','--input-format','stream-json','--verbose','--setting-sources','','--settings','{"forceLoginMethod":"claudeai","disableAllHooks":true}','--tools','','--permission-mode','dontAsk','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence']};
}
type CatalogOptions={command?:{file:string;args:string[]};timeoutMs?:number};
// Only fixed initialization/model-list frames can be written: no task, thread,
// turn, login, tool approval or Claude user message is accepted by this helper.
export async function providerModelCatalog(provider:CatalogProvider,options:CatalogOptions={}):Promise<ModelCatalog>{
 if(provider!=='codex'&&provider!=='claude')throw Error('Unsupported catalog provider');
 const command=options.command??catalogCommand(provider),workspace=mkdtempSync(join(tmpdir(),'synqo-model-catalog-'));
 try{return await new Promise<ModelCatalog>((resolve,reject)=>{
  const child=spawn(command.file,command.args,{cwd:workspace,env:{...subscriptionEnvironment(),KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'},shell:false,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']}) as ChildProcessWithoutNullStreams;
  const decoder=new StringDecoder('utf8');
  let buffer='',bytes=0,result:ModelCatalog|undefined,error:Error|undefined,stopping=false;
  const kill=(signal:NodeJS.Signals)=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{/* Already exited. */}};
  let force:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{if(stopping)return;stopping=true;child.stdin.end();kill('SIGTERM');force=setTimeout(()=>kill('SIGKILL'),500);};
  const fail=()=>{error=Error('Model catalog unavailable. Check the provider login and retry Refresh models; no prompt was sent.');stop();};
  const timer=setTimeout(fail,options.timeoutMs??10_000);
  const send=(frame:unknown)=>{if(!stopping)child.stdin.write(JSON.stringify(frame)+'\n');};
  child.stdin.on('error',()=>{if(!stopping)fail();});
  child.once('error',fail);
  child.stdout.on('data',chunk=>{
   bytes+=chunk.length;if(bytes>1_000_000){fail();return;}buffer+=decoder.write(chunk);
   while(buffer.includes('\n')&&!stopping){const index=buffer.indexOf('\n'),line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
    try{const message=JSON.parse(line);
     if(provider==='codex'){
      if(message.error){fail();return;}
      if(message.id===1){send({method:'initialized',params:{}});send({id:2,method:'model/list',params:{limit:200,includeHidden:false}});}
      if(message.id===2){result=normalizeCatalog(provider,message.result?.data,!!message.result?.nextCursor);stop();}
     }else if(message.type==='control_response'&&message.response?.request_id==='synqo-model-list'){
      if(message.response.subtype!=='success'){fail();return;}
      result=normalizeCatalog(provider,message.response.response?.models);stop();
     }else if(message.type==='assistant'||message.type==='result'||message.type==='control_request'){fail();return;}
    }catch{fail();return;}
   }
  });
  child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>1_000_000)fail();});
  child.once('close',()=>{clearTimeout(timer);if(force)clearTimeout(force);if(result&&!error)resolve(result);else reject(error??Error('Model catalog closed before returning models; no prompt was sent.'));});
  if(provider==='codex')send({id:1,method:'initialize',params:{clientInfo:{name:'synqo-model-list',title:'synqo model catalog',version:'0.1.0'}}});
  else send({type:'control_request',request_id:'synqo-model-list',request:{subtype:'initialize',hooks:{}}});
 });}finally{rmSync(workspace,{recursive:true,force:true});}
}
