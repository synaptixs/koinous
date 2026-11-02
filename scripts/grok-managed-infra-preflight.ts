import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {GrokVMLifecycle,vmConfig,SANDBOX_CHECKS} from '../src/grok-vm-lifecycle.ts';
import {vmCommand} from '../src/vm-command.ts';

export async function infrastructurePreflight(runtime:Pick<GrokVMLifecycle,'prepare'|'assertReady'|'dispose'>,signal:AbortSignal){
  try{await runtime.prepare(signal);runtime.assertReady();}
  finally{await runtime.dispose();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const output=resolve(process.argv[2]||'runs/managed-infra-preflight');mkdirSync(output,{recursive:true,mode:0o700});
  const config=vmConfig();const controller=new AbortController();
  const abort=()=>controller.abort();process.on('SIGINT',abort);process.on('SIGTERM',abort);
  const operations:Array<{operation:string;status:string}>=[];
  let checks:unknown=null;
  const runtime=new GrokVMLifecycle(config,{command:async(binary,args,timeout,signal)=>{
    const operation=args[1]==='ssh'?(args[3].includes('sandbox-probe')?'sandbox-probe':args[3].includes('remount')?'read-only-mount':'credential-cleanup-check'):args[1];
    console.log(JSON.stringify({operation,status:'started'}));
    try{const result=await vmCommand(binary,args,timeout,signal);
      if(operation==='sandbox-probe')checks=JSON.parse(result);
      operations.push({operation,status:'passed'});return result;
    }catch(error){operations.push({operation,status:'failed'});throw error;}
  }});
  let error:string|null=null;
  try{await infrastructurePreflight(runtime,controller.signal);}catch(e){error=e instanceof Error?e.message:'Infrastructure preflight failed';}
  finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);}
  const auditPath=join(config.stateDir,runtime.connection.vm+'.json');
  const audit=existsSync(auditPath)?JSON.parse(readFileSync(auditPath,'utf8')):null;
  const passed=!error&&audit?.phase==='removed'&&audit?.guestCredentialsAbsent===true&&checks&&SANDBOX_CHECKS.every(k=>(checks as Record<string,unknown>)[k]===true)&&!existsSync(join(config.stateDir,'grok-vm.lock'))&&!existsSync(audit.stage);
  const result={status:passed?'passed':'failed',error,vm:runtime.connection.vm,image:config.image,imageSha256:config.imageSha256,
    sandboxChecks:checks,cleanup:audit,stageRemoved:audit?.stage?!existsSync(audit.stage):null,operations,
    realCredentialsTransferred:false,authenticationRequests:0,modelRequests:0,credentialFixture:'synthetic only'};
  writeFileSync(join(output,'verification.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result,null,2));if(!passed)process.exitCode=1;
}
