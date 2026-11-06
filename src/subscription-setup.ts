import {spawn} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {subscriptionEnvironment} from './provider-config.ts';
export type LoginProvider='codex'|'claude';
export type AuthResult={code:number;stdout:string;stderr:string};
export type AuthRunner=(provider:LoginProvider,action:'login'|'status')=>Promise<AuthResult>;
export function authCommand(provider:LoginProvider,action:'login'|'status',platform=process.platform,arch=process.arch){
 if(!['codex','claude'].includes(provider)||!['login','status'].includes(action))throw Error('Choose login/status and codex/claude only.');
 const root=fileURLToPath(new URL('../node_modules/',import.meta.url));
 if(provider==='codex')return {file:process.execPath,args:[join(root,'@openai/codex/bin/codex.js'),'-c','forced_login_method="chatgpt"','-c','model_provider="openai"','login',...(action==='status'?['status']:[])]};
 if(!['darwin','linux','win32'].includes(platform)||!['x64','arm64'].includes(arch))throw Error('Unsupported CLI platform; use a supported developer workstation.');
 return {file:join(root,`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`,platform==='win32'?'claude.exe':'claude'),args:['--settings','{"forceLoginMethod":"claudeai"}','--setting-sources','','auth',action,...(action==='login'?['--claudeai']:[])]};
}
export const runAuth:AuthRunner=async(provider,action)=>{
 const command=authCommand(provider,action);
 const binary=provider==='codex'?command.args[0]:command.file;
 if(!existsSync(binary))throw Error('Pinned provider CLI missing. Run npm ci, then retry setup.');
 // Resolve only the pinned packages; never npx-download or choose an ambient CLI.
 const root=fileURLToPath(new URL('../node_modules/',import.meta.url));
 const pkg=JSON.parse(readFileSync(join(root,provider==='codex'?'@openai/codex/package.json':'@anthropic-ai/claude-agent-sdk/package.json'),'utf8'));
 if(pkg.version!==(provider==='codex'?'0.166.0':'0.3.316'))throw Error('Provider version mismatch. Restore dependencies with npm ci.');
 return new Promise((resolve,reject)=>{
  const child=spawn(command.file,command.args,{shell:false,env:{...subscriptionEnvironment(),KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'},stdio:action==='login'?'inherit':['ignore','pipe','pipe']});
  let stdout='',stderr='',bytes=0,failed=false;
  let killTimer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{failed=true;child.kill();killTimer??=setTimeout(()=>child.kill('SIGKILL'),1000);};
  const timer=setTimeout(stop,action==='login'?300000:15000);
  const collect=(kind:'stdout'|'stderr',chunk:Buffer)=>{bytes+=chunk.length;if(bytes>65536){stop();return;}if(kind==='stdout')stdout+=chunk;else stderr+=chunk;};
  child.stdout?.on('data',chunk=>collect('stdout',chunk));child.stderr?.on('data',chunk=>collect('stderr',chunk));
  child.once('error',()=>{failed=true;});
  child.once('close',code=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);if(failed)reject(Error('Provider authentication command failed or timed out. No model call was made.'));else resolve({code:code??1,stdout,stderr});});
 });
};
export function subscriptionReady(provider:LoginProvider,result:AuthResult):boolean {
 if(result.code!==0)return false;
 if(provider==='codex')return (result.stdout+'\n'+result.stderr).trim()==='Logged in using ChatGPT';
 try{const data=JSON.parse(result.stdout);return data.loggedIn===true&&data.authMethod==='claude.ai';}catch{return false;}
}
export async function checkSubscriptions(run:AuthRunner=runAuth,providers:readonly LoginProvider[]=['codex','claude']){
 const result={codex:false,claude:false};
 for(const provider of providers){
  // An absent CLI, timeout or unconfirmed account must not hide another provider.
  try{result[provider]=subscriptionReady(provider,await run(provider,'status'));}catch{result[provider]=false;}
 }
 return result;
}
export async function setup(args:string[],run:AuthRunner=runAuth):Promise<string>{
 if(!args.length)return 'Provider account setup — personal or enterprise (no model calls):\n1. npm ci\n2. Sign in only to the providers you want: npm run setup -- login codex and/or npm run setup -- login claude\n3. npm run setup -- status\nThen: npm run start:real -- --enable-inference\nUnavailable providers are skipped at startup; no automatic browser login. Sign in with your personal or enterprise ChatGPT/Claude account in the provider browser flow, including SSO when your organization requires it. Confirm the intended workspace and administrator access. Never paste keys into synqo. Setup does not enable inference.';
 if(args.length===1&&args[0]==='status'){
  const ready=await checkSubscriptions(run);
  return `Codex account login (personal or enterprise): ${ready.codex?'ready':'not confirmed'}\nClaude account login (personal or enterprise): ${ready.claude?'ready':'not confirmed'}\nLogin state does not verify the selected enterprise workspace, organization entitlement or quota. No model call was made.`;
 }
 if(args.length===2&&args[0]==='login'&&['codex','claude'].includes(args[1])){
  const provider=args[1] as LoginProvider;const result=await run(provider,'login');
  if(result.code!==0)throw Error(`${provider} login did not complete. Retry setup; no API-key fallback.`);
  return `${provider} browser login finished. Run npm run setup -- status to confirm provider account authentication. Inference remains disabled.`;
 }
 throw Error('Use npm run setup, setup -- login codex, setup -- login claude, or setup -- status.');
}
