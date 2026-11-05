import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {authCommand,subscriptionReady} from '../src/subscription-setup.ts';
import type {AuthResult,LoginProvider} from '../src/subscription-setup.ts';
import {subscriptionEnvironment} from '../src/provider-config.ts';

export type DemoCommand={file:string;args:string[];capture:boolean;timeoutMs:number;purpose?:'server'};
export type DemoRunner=(command:DemoCommand,signal:AbortSignal)=>Promise<AuthResult>;
const root=fileURLToPath(new URL('../',import.meta.url));
// Shell-free argv supports spaces and Windows npm paths. Never forward ambient API keys.
export function runDemoCommand(command:DemoCommand,signal:AbortSignal):Promise<AuthResult>{
 signal.throwIfAborted();
 return new Promise((resolveResult,reject)=>{
  const env={...subscriptionEnvironment(),KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0',KOINOUS_DISABLED_PROVIDERS:'grok'};
  // Search credentials belong only to the app server, never install/auth children.
  if(command.purpose==='server'&&process.env.BRAVE_SEARCH_API_KEY)Object.assign(env,{BRAVE_SEARCH_API_KEY:process.env.BRAVE_SEARCH_API_KEY});
  // PORT is an optional launcher setting.
  if(process.env.PORT)Object.assign(env,{PORT:process.env.PORT});
  const child=spawn(command.file,command.args,{cwd:root,env,shell:false,stdio:command.capture?['ignore','pipe','pipe']:'inherit'});
  let stdout='',stderr='',bytes=0,failed=false;
  let killTimer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{failed=true;child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),command.timeoutMs===0?10000:1000);};
  signal.addEventListener('abort',stop,{once:true});
  const timer=command.timeoutMs?setTimeout(stop,command.timeoutMs):undefined;
  const collect=(kind:'stdout'|'stderr',chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536){stop();return;}if(kind==='stdout')stdout+=chunk;else stderr+=chunk;};
  child.stdout?.on('data',chunk=>collect('stdout',chunk));child.stderr?.on('data',chunk=>collect('stderr',chunk));
  child.once('error',()=>{failed=true;});
  child.once('close',code=>{clearTimeout(timer);clearTimeout(killTimer);signal.removeEventListener('abort',stop);if(failed)reject(Error('Demo step stopped, timed out or failed to launch. No automatic retry.'));else resolveResult({code:code??1,stdout,stderr});});
  if(signal.aborted)stop();
 });
}
export async function demoLive(args:string[],options:{run?:DemoRunner;signal?:AbortSignal;log?:(s:string)=>void;npmPath?:string;nodeVersion?:string}={}){
 const log=options.log??console.log,run=options.run??runDemoCommand,signal=options.signal??new AbortController().signal;
 if(args.length===1&&args[0]==='--help'){log('npm run demo:live — installs pinned dependencies, opens missing personal/enterprise provider login flows, then starts the live UI. No model calls until Start discussion. Ctrl+C stops. Use -- --openai-only for two OpenAI models with one corporate ChatGPT/Codex login (no Claude login). Requires Node 22.16+ and internet.');return;}
 const openaiOnly=args.length===1&&args[0]==='--openai-only';
 if(args.length&&!openaiOnly)throw Error('Use npm run demo:live, -- --openai-only, or -- --help.');
 const [major,minor]=(options.nodeVersion??process.versions.node).split('.').map(Number);
 if(!Number.isInteger(major)||major<22||(major===22&&minor<16))throw Error('Install Node.js 22.16 or newer (with npm), then retry.');
 const npmPath=options.npmPath??process.env.npm_execpath;
 if(!npmPath)throw Error('Start with npm run demo:live so the installed npm CLI can be located.');
 const step=async(command:DemoCommand)=>{signal.throwIfAborted();const result=await run(command,signal);signal.throwIfAborted();return result;};
 log('Installing pinned dependencies with npm ci. Existing node_modules will be replaced. Grok off; inference disabled during setup.');
 if((await step({file:process.execPath,args:[npmPath,'ci','--include=dev','--include=optional'],capture:false,timeoutMs:600000})).code!==0)throw Error('Dependency installation failed. Check internet/registry access, then rerun npm run demo:live.');
 for(const provider of (openaiOnly?['codex']:['codex','claude']) as LoginProvider[]){
  const auth=(action:'login'|'status')=>step({...authCommand(provider,action),capture:action==='status',timeoutMs:action==='status'?15000:300000});
  if(!subscriptionReady(provider,await auth('status'))){
   log(`Sign in to your own ${provider==='codex'?'ChatGPT':'Claude'} personal or enterprise account in the provider login flow. No API-key fallback.`);
   if((await auth('login')).code!==0)throw Error(`${provider} login did not complete. Rerun when ready.`);
   if(!subscriptionReady(provider,await auth('status')))throw Error(`${provider} provider account login not confirmed. Live startup refused.`);
  }
  log(`${provider}: provider account login confirmed (personal or enterprise; workspace/entitlement not verified).`);
 }
 log('Starting '+(openaiOnly?'OpenAI-only':'Codex/Claude')+' live demo. Open the URL printed below; Start discussion uses your provider account quota. Ctrl+C stops the server.');
 const result=await step({file:process.execPath,args:['--experimental-strip-types','scripts/start-real.ts','--enable-inference',...(openaiOnly?['--openai-only']:[])],capture:false,timeoutMs:0,purpose:'server'});
 if(result.code!==0)throw Error('Live demo server exited unsuccessfully. Check the message above; no automatic restart.');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const controller=new AbortController();const stop=()=>controller.abort();
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{await demoLive(process.argv.slice(2),{signal:controller.signal});}
 catch(error){if(!controller.signal.aborted){console.error(error instanceof Error?error.message:'Demo startup failed.');process.exitCode=1;}}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
