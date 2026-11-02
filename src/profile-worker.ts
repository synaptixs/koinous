import {inspectionSandbox} from './worker-sandbox.ts';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workerEnvironment} from './worker-profiles.ts';
import type {WorkerProfile} from './worker-profiles.ts';
export class ProfileWorkers {
 private active=new Map<string,{stop:()=>void;done:Promise<unknown>}>();private stopping=false;
 async inspect(profile:WorkerProfile,signal:AbortSignal,timeoutMs=5000):Promise<unknown>{
  if(this.stopping||signal.aborted)throw Error('Worker unavailable');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid worker deadline');
  if(this.active.has(profile.root)||this.active.size>=8)throw Error('Worker capacity unavailable');
  if(Number(process.versions.node.split('.')[0])<26)throw Error('Restricted worker requires Node 26 or newer');
  const script=fileURLToPath(new URL('../scripts/runtime/profile-worker.mjs',import.meta.url));
  const sandbox=inspectionSandbox(profile,script);
  const child=spawn(sandbox.command,[...sandbox.args,'--permission',`--allow-fs-read=${profile.root}`,`--allow-fs-read=${script}`,script],{env:workerEnvironment(profile),cwd:profile.workspace,shell:false,stdio:['pipe','pipe','pipe']});
  let stop=()=>{};
  const done=new Promise<unknown>((resolve,reject)=>{
   let output='',bytes=0,failed=false;
   stop=()=>{failed=true;child.kill('SIGKILL');};
   const timer=setTimeout(stop,timeoutMs);const onAbort=()=>stop();signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)stop();
   child.stdin.on('error',stop);child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>8192)stop();else output+=chunk.toString();});child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>8192)stop();});
   child.once('error',()=>{failed=true;});
   child.once('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',onAbort);this.active.delete(profile.root);
    try{if(failed||code!==0)throw Error();const result=JSON.parse(output);if(result.ok!==true||result.provider!==profile.provider||result.authenticationVerified!==false||result.inferenceEnabled!==false||typeof result.credentialFilePresent!=='boolean'||!result.checks||['outsideProfileDenied','childProcessDenied','networkDenied','filesystemWriteDenied'].some(k=>result.checks[k]!==true))throw Error();resolve({ok:true,provider:profile.provider,credentialFilePresent:result.credentialFilePresent,authenticationVerified:false,inferenceEnabled:false,checks:{outsideProfileDenied:true,childProcessDenied:true,networkDenied:true,filesystemWriteDenied:true}});}catch{reject(Error('Restricted worker preflight failed'));}
   });
   child.stdin.end(JSON.stringify({kind:'inspect',provider:profile.provider,root:profile.root}));
  });
  this.active.set(profile.root,{stop:()=>stop(),done});return done;
 }
 async shutdown(){this.stopping=true;const workers=[...this.active.values()];for(const w of workers)w.stop();await Promise.allSettled(workers.map(w=>w.done));}
}
