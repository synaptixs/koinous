import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {GrokVMLifecycle,vmConfig,SANDBOX_CHECKS} from '../src/grok-vm-lifecycle.ts';
import {vmCommand} from '../src/vm-command.ts';
export async function proxyInfrastructurePreflight(runtime:Pick<GrokVMLifecycle,'prepare'|'assertReady'|'dispose'>,probe:()=>Promise<unknown>,signal:AbortSignal){
 try{await runtime.prepare(signal);runtime.assertReady();signal.throwIfAborted();return await probe();}
 finally{await runtime.dispose();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 if(process.env.KOINOUS_ENABLE_INFERENCE!=='0'||process.env.GROK_BUILD_ENABLE_INFERENCE!=='0')throw Error('Infrastructure verification requires inference disabled');
 const output=resolve(process.argv[2]||'runs/grok-proxy-infrastructure');mkdirSync(output,{recursive:true,mode:0o700});
 const config={...vmConfig(),authHome:join(output,'unused-synthetic-home'),egressHosts:[]};
 const controller=new AbortController(),abort=()=>controller.abort();const deadline=setTimeout(abort,240000);
 process.on('SIGINT',abort);process.on('SIGTERM',abort);
 const operations:Array<{operation:string;status:string}>=[];let sandbox:any=null;
 const runtime=new GrokVMLifecycle(config,{command:async(binary,args,timeout,signal)=>{
  const operation=args[1]==='ssh'?(args[3].includes('sandbox-probe')?'sandbox-probe':args[3].includes('remount')?'read-only-mount':'cleanup-check'):args[1];
  console.log(JSON.stringify({operation,status:'started'}));
  try{const result=await vmCommand(binary,args,timeout,signal);if(operation==='sandbox-probe')sandbox=JSON.parse(result);operations.push({operation,status:'passed'});return result;}
  catch(e){operations.push({operation,status:'failed'});throw e;}
 }});
 let probe:any=null,error:string|null=null;
 try{probe=await proxyInfrastructurePreflight(runtime,async()=>{
  console.log(JSON.stringify({operation:'synthetic-proxy',status:'started'}));
  const source=readFileSync(new URL('./runtime/grok-proxy-probe.py',import.meta.url)).toString('base64');
  const command=`/usr/bin/python3 -B -c 'import base64;exec(base64.b64decode("${source}"))'`;
  return JSON.parse(await vmCommand(config.podman,['machine','ssh',runtime.connection.vm,command],60000,controller.signal));
 },controller.signal);}catch(e){error=e instanceof Error?e.message:'Infrastructure failed';}
 finally{clearTimeout(deadline);process.off('SIGINT',abort);process.off('SIGTERM',abort);}
 const auditPath=join(config.stateDir,runtime.connection.vm+'.json');const audit=existsSync(auditPath)?JSON.parse(readFileSync(auditPath,'utf8')):null;
 const passed=!error&&sandbox&&SANDBOX_CHECKS.every(k=>sandbox[k]===true)&&probe?.status==='passed'&&probe.grokExecuted===false&&probe.modelRequests===0&&probe.authenticationRequests===0&&audit?.phase==='removed'&&audit.guestCredentialsAbsent===true&&!existsSync(join(config.stateDir,'grok-vm.lock'))&&!existsSync(audit.stage);
 const result={status:passed?'passed':'failed',error,vm:runtime.connection.vm,imageSha256:config.imageSha256,sandbox,probe,cleanup:audit,stageRemoved:audit?.stage?!existsSync(audit.stage):null,operations,realCredentialsTransferred:false,authenticationRequests:0,modelRequests:0,inferenceEnabled:false};
 writeFileSync(join(output,'verification.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));if(!passed)process.exitCode=1;
}
