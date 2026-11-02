import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {authenticationPreflight,authenticationOnlySpawn} from './grok-managed-auth-preflight.ts';
import {GrokVMLifecycle,vmConfig,SANDBOX_CHECKS} from '../src/grok-vm-lifecycle.ts';
import {vmCommand} from '../src/vm-command.ts';
import {launchBuild,type BuildSpawn} from '../src/grok-build.ts';
// Public subscription endpoints present in pinned 1.0.70; API-key endpoint excluded.
export const AUTH_HOSTS=Object.freeze(['grok.com','accounts.x.ai','cli-chat-proxy.grok.com']);
export type ProxyEvidence={attempts:number;successfulDials:number;tunneledBytes:number;resolvedHosts:string[]};
export function parseProxyEvidence(line:string):ProxyEvidence|undefined{
 if(!line.startsWith('KOINOUS_EGRESS '))return;
 try{const value=JSON.parse(line.slice(15));
  if(!value||Object.keys(value).sort().join(',')!=='attempts,resolvedHosts,successfulDials,tunneledBytes')return;
  for(const key of ['attempts','successfulDials','tunneledBytes'])if(!Number.isSafeInteger(value[key])||value[key]<0)return;
  if(!Array.isArray(value.resolvedHosts)||value.resolvedHosts.length>AUTH_HOSTS.length||value.resolvedHosts.some((host:unknown)=>typeof host!=='string'||!AUTH_HOSTS.includes(host)))return;
  return {attempts:value.attempts,successfulDials:value.successfulDials,tunneledBytes:value.tunneledBytes,resolvedHosts:value.resolvedHosts};
 }catch{return;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 if(process.env.KOINOUS_ENABLE_INFERENCE!=='0'||process.env.GROK_BUILD_ENABLE_INFERENCE!=='0')throw Error('Authentication-only verification requires both inference flags 0');
 const output=resolve(process.argv[2]||'runs/grok-proxy-auth');mkdirSync(output,{recursive:true,mode:0o700});
 const config={...vmConfig(),egressHosts:AUTH_HOSTS};
 const controller=new AbortController(),abort=()=>controller.abort();const deadline=setTimeout(abort,240000);
 process.on('SIGINT',abort);process.on('SIGTERM',abort);
 let sandbox:any=null;const operations:Array<{operation:string;status:string}>=[];
 const runtime=new GrokVMLifecycle(config,{command:async(binary,args,timeout,signal)=>{
  const operation=args[1]==='ssh'?(args[3].includes('sandbox-probe')?'sandbox-probe':args[3].includes('remount')?'read-only-mount':'credential-cleanup-check'):args[1];
  console.log(JSON.stringify({operation,status:'started'}));
  try{const result=await vmCommand(binary,args,timeout,signal);if(operation==='sandbox-probe')sandbox=JSON.parse(result);operations.push({operation,status:'passed'});return result;}
  catch(e){operations.push({operation,status:'failed'});throw e;}
 }});
 const credentialDigest=()=>createHash('sha256').update(readFileSync(join(config.authHome,'auth.json'))).digest('hex');
 const methods:string[]=[],proxy:ProxyEvidence[]=[];
 const source=readFileSync(new URL('./runtime/grok-auth-proxy-audit.py',import.meta.url)).toString('base64');
 const auditedStart:BuildSpawn=o=>{
  if(o.binary!==config.podman||o.args.slice(0,3).join(',')!==['machine','ssh',runtime.connection.vm].join(','))throw Error('Unexpected authentication destination');
  const command=`/usr/bin/python3 -B -c 'import base64;exec(base64.b64decode("${source}"))'`;
  const child=spawn(o.binary,[...o.args.slice(0,3),command],{env:o.env,cwd:o.cwd,shell:false,stdio:['pipe','pipe','pipe']});
  let buffer='';child.stderr.on('data',chunk=>{
   buffer=(buffer+chunk.toString()).slice(-8192);
   while(buffer.includes('\n')){const at=buffer.indexOf('\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+1);const parsed=parseProxyEvidence(line);if(parsed&&proxy.length<4)proxy.push(parsed);}
  });return child;
 };
 let error:string|null=null,before:string|undefined,credentialSourceUnchanged=false;
 try{before=credentialDigest();await authenticationPreflight(runtime,controller.signal,launchBuild,authenticationOnlySpawn(methods,auditedStart));}
 catch(e){error=e instanceof Error?e.message:'Authentication check failed';}
 finally{clearTimeout(deadline);process.off('SIGINT',abort);process.off('SIGTERM',abort);try{credentialSourceUnchanged=before!==undefined&&before===credentialDigest();}catch{credentialSourceUnchanged=false;}}
 const auditPath=join(config.stateDir,runtime.connection.vm+'.json');const audit=existsSync(auditPath)?JSON.parse(readFileSync(auditPath,'utf8')):null;
 const cleaned=audit?.phase==='removed'&&audit.guestCredentialsAbsent===true&&!existsSync(join(config.stateDir,'grok-vm.lock'))&&!existsSync(audit.stage);
 const authenticated=!error&&methods.join(',')==='initialize,authenticate';
 const proxyTrafficObserved=proxy.some(p=>p.successfulDials>0&&p.tunneledBytes>0);
 const passed=authenticated&&proxyTrafficObserved&&credentialSourceUnchanged&&cleaned&&sandbox&&SANDBOX_CHECKS.every(k=>sandbox[k]===true);
 const result={status:passed?'passed':'not_verified',error,vm:runtime.connection.vm,imageSha256:config.imageSha256,allowedHosts:AUTH_HOSTS,
  sandbox,proxy,proxyTrafficObserved,authentication:authenticated?'passed':'not_verified',credentialSourceUnchanged,cleanup:audit,stageRemoved:audit?.stage?!existsSync(audit.stage):null,
  methodsSent:methods,authenticationRequests:methods.filter(m=>m==='authenticate').length,modelRequests:0,inferenceEnabled:false,operations};
 writeFileSync(join(output,'verification.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));if(!passed)process.exitCode=1;
}
