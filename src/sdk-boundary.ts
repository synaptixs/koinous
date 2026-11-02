import type {WorkerProfile} from './worker-profiles.ts';
import {sdkBundle,executionSandbox,executionEnvironment} from './sdk-execution.ts';
import {WorkerEgress} from './worker-egress.ts';
import type {EgressIO} from './worker-egress.ts';

// Deployment-side preparation only, not a public request handler. No credentials
// are read and no SDK is launched here. SDKWorkers.run remains fail-closed.
export async function prepareSDKBoundary(profile:WorkerProfile,hosts:readonly string[],signal:AbortSignal,io?:EgressIO){
 signal.throwIfAborted();const bundle=sdkBundle(profile.provider),broker=new WorkerEgress(hosts,io);
 const abort=()=>broker.revoke();signal.addEventListener('abort',abort,{once:true});
 try{
  const endpoint=await broker.start();signal.throwIfAborted();
  return {bundle,sandbox:executionSandbox(profile,bundle,endpoint.port,true),env:executionEnvironment(profile,endpoint.url),
   async close(){signal.removeEventListener('abort',abort);await broker.close();}};
 }catch(e){signal.removeEventListener('abort',abort);await broker.close();throw e;}
}
