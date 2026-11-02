import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {launchBuild,type BuildSpawn} from '../src/grok-build.ts';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {GrokVMLifecycle,vmConfig,SANDBOX_CHECKS} from '../src/grok-vm-lifecycle.ts';
import {vmCommand} from '../src/vm-command.ts';

// Observe only method names; never retain credential envelopes or authentication payloads.
export function authenticationOnlySpawn(methods:string[],start:BuildSpawn=o=>spawn(o.binary,o.args,{env:o.env,cwd:o.cwd,shell:false,stdio:['pipe','pipe','pipe']})):BuildSpawn{
  return options=>{
    const child=start(options);
    child.stdin.write=new Proxy(child.stdin.write,{apply(target,thisArg,args){
      const message=JSON.parse(String(args[0]));
      if(message.method){
        if(!['initialize','authenticate'].includes(message.method))throw Error('Inference and other protocol methods are forbidden in authentication preflight');
        methods.push(message.method);
      }
      return Reflect.apply(target,thisArg,args);
    }});
    return child;
  };
}
export async function authenticationPreflight(runtime:Pick<GrokVMLifecycle,'prepare'|'assertReady'|'dispose'|'connection'>,signal:AbortSignal,launch:typeof launchBuild=launchBuild,start?:BuildSpawn){
  if(process.env.GROK_BUILD_ENABLE_INFERENCE!=='0')throw Error('Authentication preflight requires GROK_BUILD_ENABLE_INFERENCE=0');
  try{
    await runtime.prepare(signal);runtime.assertReady();
    await launch(signal,undefined,start,process.env.GROK_BUILD_MODEL||'grok-4.7',runtime.connection);
  }finally{await runtime.dispose();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const output=resolve(process.argv[2]||'runs/managed-auth-preflight');mkdirSync(output,{recursive:true,mode:0o700});
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
  const methods:string[]=[];
  const credentialPath=join(config.authHome,'auth.json');
  const credentialDigest=()=>createHash('sha256').update(readFileSync(credentialPath)).digest('hex');
  const before=credentialDigest();
  let error:string|null=null;
  try{await authenticationPreflight(runtime,controller.signal,launchBuild,authenticationOnlySpawn(methods));}catch(e){error=e instanceof Error?e.message:'Infrastructure preflight failed';}
  finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);}
  const auditPath=join(config.stateDir,runtime.connection.vm+'.json');
  const audit=existsSync(auditPath)?JSON.parse(readFileSync(auditPath,'utf8')):null;
  const credentialSourceUnchanged=before===credentialDigest();
  const passed=!error&&credentialSourceUnchanged&&methods.join(',')==='initialize,authenticate'&&audit?.phase==='removed'&&audit?.guestCredentialsAbsent===true&&checks&&SANDBOX_CHECKS.every(k=>(checks as Record<string,unknown>)[k]===true)&&!existsSync(join(config.stateDir,'grok-vm.lock'))&&!existsSync(audit.stage);
  const result={status:passed?'passed':'failed',error,vm:runtime.connection.vm,image:config.image,imageSha256:config.imageSha256,
    sandboxChecks:checks,cleanup:audit,stageRemoved:audit?.stage?!existsSync(audit.stage):null,operations,
    credentialSourceUnchanged,methodsSent:methods,authenticationRequests:methods.filter(m=>m==='authenticate').length,modelRequests:methods.filter(m=>m.startsWith('session/')).length,inferenceEnabled:process.env.GROK_BUILD_ENABLE_INFERENCE==='1',authentication:error?'not_verified':'passed'};
  writeFileSync(join(output,'verification.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result,null,2));if(!passed)process.exitCode=1;
}
