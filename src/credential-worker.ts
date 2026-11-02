import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import type {Identity} from './browser-auth.ts';
import {WorkerProfiles,type WorkerProfile} from './worker-profiles.ts';
import {prepareSDKBoundary} from './sdk-boundary.ts';
import {ProviderFailure} from './provider-runtime.ts';

type Boundary=Awaited<ReturnType<typeof prepareSDKBoundary>>;
type Process={done:Promise<string>;stop:()=>void};
// Trusted deployment/test wiring only. Neither launcher nor hosts can come from
// an HTTP request. No default inference launcher exists in this release.
export type CredentialWorkerDriver={
 prepare:(profile:WorkerProfile,signal:AbortSignal)=>Promise<Boundary>;
 launch:(profile:WorkerProfile,boundary:Boundary,signal:AbortSignal,timeoutMs:number)=>Process;
};
export class CredentialWorkers {
 private stopping=false;
 private active=new Set<{controller:AbortController;done:Promise<string>}>();
 private profiles:WorkerProfiles;private driver?:CredentialWorkerDriver;
 constructor(profiles:WorkerProfiles,driver?:CredentialWorkerDriver){this.profiles=profiles;this.driver=driver;}
 run(identity:Identity,provider:string,signal:AbortSignal,timeoutMs=5000):Promise<string>{
  if(!this.driver)return Promise.reject(Error('Credential worker execution disabled'));
  if(this.stopping||signal.aborted)return Promise.reject(Error('Credential worker unavailable'));
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)return Promise.reject(Error('Invalid credential worker deadline'));
  if(this.active.size>=8)return Promise.reject(Error('Credential worker capacity unavailable'));
  const controller=new AbortController(),abort=()=>controller.abort();
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  const entry={controller,done:Promise.resolve('')};
  entry.done=this.execute({...identity},provider,controller.signal,timeoutMs).catch(()=>{
   throw new ProviderFailure(timedOut?'timeout':controller.signal.aborted?'cancelled':'provider_error','Credential worker failed',{usage:{usd:null}});
  }).finally(()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.active.delete(entry);});
  this.active.add(entry);return entry.done;
 }
 private async execute(identity:Identity,provider:string,signal:AbortSignal,timeoutMs:number){
  signal.throwIfAborted();
  const profile=this.profiles.resolve(identity,provider);
  if(!profile||!['codex','claude'].includes(provider))throw Error('Credential profile unavailable');
  // Atomic across manager instances/processes. A crash leaves a blocking lease;
  // recovery requires operator verification that no worker is still alive.
  const lock=join(profile.root,'worker.lease');mkdirSync(lock,{mode:0o700});
  let scratch:string|undefined,boundary:Boundary|undefined,worker:Process|undefined;
  const stop=()=>worker?.stop();signal.addEventListener('abort',stop,{once:true});
  try{
   scratch=mkdtempSync(join(profile.tmp,'worker-'));
   const scoped=Object.freeze({...profile,tmp:scratch});
   boundary=await this.driver!.prepare(scoped,signal);signal.throwIfAborted();
   // Revalidate ownership immediately before handing the credential grant to a child.
   if(this.profiles.resolve(identity,provider)!==profile)throw Error('Credential owner changed');
   worker=this.driver!.launch(scoped,boundary,signal,timeoutMs);
   const output=await worker.done;signal.throwIfAborted();return output;
  }finally{
   signal.removeEventListener('abort',stop);
   // Keep both broker port and profile lease until the process group is reaped.
   // Any teardown failure retains the lease rather than allowing unsafe reuse.
   if(worker){worker.stop();await worker.done.catch(()=>{});}
   if(boundary)await boundary.close();
   if(scratch)rmSync(scratch,{recursive:true,force:true});
   rmSync(lock,{recursive:true});
  }
 }
 async shutdown(){this.stopping=true;const active=[...this.active];for(const entry of active)entry.controller.abort();await Promise.allSettled(active.map(entry=>entry.done));}
}
