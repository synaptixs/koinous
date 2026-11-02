import {CLI_PINS} from './native-cli.ts';
import {confinedProcess} from './confined-process.ts';
import type {WorkerProfile} from './worker-profiles.ts';
import {sdkBundle,executionSandbox,executionEnvironment,SDK_PINS} from './sdk-execution.ts';

// Deliberately not wired to protected inference. Import acceptance cannot lift the
// separate account/egress/descendant-containment deployment gate.
export class SDKWorkers {
 private active=new Map<string,{stop:()=>void;done:Promise<unknown>}>();private stopping=false;
 async run(_profile:WorkerProfile,_prompt:string):Promise<never>{throw Error('SDK inference disabled; execution acceptance pending');}
 async inspectNative(profile:WorkerProfile,signal:AbortSignal,timeoutMs=5000){return this.inspect(profile,signal,timeoutMs,'native-check');}
 async inspect(profile:WorkerProfile,signal:AbortSignal,timeoutMs=5000,kind:'import-check'|'native-check'='import-check'){
  if(!['import-check','native-check'].includes(kind))throw Error('Invalid worker check');
  if(this.stopping||signal.aborted)throw Error('SDK worker unavailable');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid SDK worker deadline');
  if(this.active.size>=8||this.active.has(profile.root))throw Error('SDK worker capacity unavailable');
  const bundle=sdkBundle(profile.provider),sandbox=executionSandbox(profile,bundle);
  const worker=confinedProcess(sandbox.command,[...sandbox.args,bundle.script],executionEnvironment(profile),profile.workspace,JSON.stringify({kind,provider:bundle.provider}),signal,timeoutMs);
  const done=worker.done.then(output=>{
   const r=JSON.parse(output);
   if(r.ok!==true||r.provider!==profile.provider||r.sdkVersion!==SDK_PINS[bundle.provider]||r.authenticationVerified!==false||r.inferenceEnabled!==false)throw Error();
   const n=r.nativeCLI;
   if(kind==='native-check'&&(!n||n.cliVersion!==CLI_PINS[bundle.provider]||n.startupOnly!==true||n.versionCommandPassed!==true||n.helpCommandPassed!==true||typeof n.stderrObserved!=='boolean'))throw Error();
   const nativeCLI=kind==='native-check'?{cliVersion:CLI_PINS[bundle.provider],startupOnly:true,versionCommandPassed:true,helpCommandPassed:true,stderrObserved:n.stderrObserved}:undefined;
   return {ok:true,...(nativeCLI?{nativeCLI}:{}),provider:bundle.provider,sdkVersion:SDK_PINS[bundle.provider],authenticationVerified:false,inferenceEnabled:false};
  }).catch(()=>{throw Error('Confined SDK import check failed');}).finally(()=>{this.active.delete(profile.root);});
  this.active.set(profile.root,{stop:worker.stop,done});return done;
 }
 async shutdown(){this.stopping=true;const active=[...this.active.values()];for(const p of active)p.stop();await Promise.allSettled(active.map(p=>p.done));}
}
