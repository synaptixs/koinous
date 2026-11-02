import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {Codex} from '@openai/codex-sdk';
import {createAdapters,CodexAdapter,codexReasoningEffort} from '../src/adapters.ts';
import {ARMS,executeCell,evaluationSelection,validateTasks} from '../src/evaluation.ts';
const selection=evaluationSelection({providers:['codex','codex-2'],models:{codex:'gpt-6-astra','codex-2':'gpt-6.1-sol'}});
const tasks=validateTasks(JSON.parse(readFileSync(new URL('../evaluation/tasks.json',import.meta.url),'utf8')));
function root(t:test.TestContext){const path=mkdtempSync(join(tmpdir(),'koinous-reasoning-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
test('every evaluation arm forwards medium for both requested models at the SDK boundary',async t=>{
 const optionsSeen:unknown[]=[];const calls:string[]=[];
 t.mock.method(Codex.prototype,'startThread',function(options:{model:string;modelReasoningEffort?:string;sandboxMode:string;approvalPolicy:string;networkAccessEnabled:boolean}){
  optionsSeen.push(options);
  assert.equal(options.modelReasoningEffort,'medium');assert.equal(options.sandboxMode,'read-only');assert.equal(options.approvalPolicy,'never');assert.equal(options.networkAccessEnabled,false);
  return {id:'fake-'+options.model,async run(){calls.push(options.model);return {items:[],finalResponse:'Synthetic response, no inference',usage:null};}};
 });
 const dir=root(t);
 for(const arm of ARMS)await executeCell(tasks[0],selection,arm,dir,s=>createAdapters('real',s.providers,s.models,'medium'),new AbortController().signal);
 assert.equal(calls.length,16);assert.equal(calls.filter(m=>m==='gpt-6-astra').length,8);assert.equal(calls.filter(m=>m==='gpt-6.1-sol').length,8);assert.equal(optionsSeen.length,12);
});
test('unspecified effort preserves SDK defaults; invalid effort refuses before SDK use',async()=>{
 let loaded=0;
 const adapter=new CodexAdapter(async()=>{loaded++;return {startThread(options){assert.equal('modelReasoningEffort' in options,false);return {id:'fake',async run(){return {items:[],finalResponse:'fixture',usage:null};}};}};},'model');
 await adapter.run('fixture',1,new AbortController().signal);assert.equal(loaded,1);
 for(const value of [null,{},'',1,'MEDIUM','invalid'])assert.throws(()=>codexReasoningEffort(value));
 assert.equal(codexReasoningEffort('medium'),'medium');
});
test('CLI preflight records exact requested effort and hashes settings without authenticating',t=>{
 const dir=root(t);const configPath=join(dir,'config.json');
 const run=(effort:unknown,name:string)=>{
  writeFileSync(configPath,JSON.stringify({selection,split:'development',codexReasoningEffort:effort}));
  const out=join(dir,name);
  const result=spawnSync(process.execPath,['--experimental-strip-types','scripts/evaluate.ts','preflight',configPath,out],{cwd:new URL('..',import.meta.url),env:{...process.env,KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'},encoding:'utf8'});
  return {result,out};
 };
 const medium=run('medium','medium');assert.equal(medium.result.status,0,medium.result.stderr);
 const high=run('high','high');assert.equal(high.result.status,0,high.result.stderr);
 const a=JSON.parse(readFileSync(join(medium.out,'manifest.json'),'utf8')),b=JSON.parse(readFileSync(join(high.out,'manifest.json'),'utf8'));
 assert.deepEqual(a.selection,selection);assert.equal(a.settings.reasoning.codex,'medium');assert.equal(a.maxCalls,32);assert.equal(a.protocol,'koinous-p6-v2');assert.equal(a.synthetic,true);assert.equal(a.authorization,null);assert.notEqual(a.protocolHash,b.protocolHash);
 assert.notEqual(run('invalid','invalid').result.status,0);
});
