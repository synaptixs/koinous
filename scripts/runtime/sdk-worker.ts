// No SDK method is invoked by import-check. Inference is a distinct, gated command.
import {installConfinedSpawn} from '../../src/confined-spawn.ts';
import {workerFailure} from '../../src/worker-failure.ts';
import {executionAdapter} from '../../src/sdk-adapter.ts';
import {nativeCLICompatibility} from '../../src/native-cli.ts';
import {SDK_PINS,sdkBundle} from '../../src/sdk-execution.ts';
import type {SDKBundle} from '../../src/sdk-execution.ts';
import type {WorkerProfile} from '../../src/worker-profiles.ts';
import type {Round} from '../../src/core.ts';
let executing=false;
try{
 installConfinedSpawn();
 let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>65536)throw Error();}
 const request=JSON.parse(input);
 if(request.kind==='import-check'||request.kind==='native-check'){
  if(Object.keys(request).sort().join(',')!=='kind,provider'||!['codex','claude'].includes(request.provider)||process.env.KOINOUS_ENABLE_INFERENCE!=='0')throw Error();
  if(request.provider==='codex')await import('@openai/codex-sdk');else await import('@anthropic-ai/claude-agent-sdk');
  const nativeCLI=request.kind==='native-check'?await nativeCLICompatibility(request.provider,sdkBundle(request.provider).cli):undefined;
  process.stdout.write(JSON.stringify({ok:true,...(nativeCLI?{nativeCLI}:{}),provider:request.provider,sdkVersion:SDK_PINS[request.provider as keyof typeof SDK_PINS],authenticationVerified:false,inferenceEnabled:false})+'\n');
 }else{
  // Parent never enables this in the current release. No request field can enable it.
  if(process.env.KOINOUS_ENABLE_INFERENCE!=='1')throw Error();
  if(Object.keys(request).sort().join(',')!=='bundle,kind,model,profile,prompt,round'||request.kind!=='run'||typeof request.prompt!=='string'||request.prompt.length>24000||typeof request.model!=='string'||!request.model||request.model.length>128||![1,2,3].includes(request.round))throw Error();
  const profile=request.profile as WorkerProfile,bundle=request.bundle as SDKBundle;
  if(profile.provider!==bundle.provider||process.env.HOME!==profile.home||process.cwd()!==profile.workspace)throw Error();
  const env=Object.fromEntries(Object.entries(process.env).filter((entry):entry is [string,string]=>entry[1]!==undefined));
  executing=true;
  const result=await executionAdapter(profile,bundle,request.model,env).run(request.prompt,request.round as Round,new AbortController().signal);
  const output=JSON.stringify({ok:true,reply:result});if(Buffer.byteLength(output)>65536)throw Error();process.stdout.write(output+'\n');
 }
}catch(error){process.stdout.write(JSON.stringify(executing?workerFailure(error):{ok:false,error:'sdk_worker_failed'})+'\n');process.exitCode=1;}
