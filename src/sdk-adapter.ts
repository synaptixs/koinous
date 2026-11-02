import {terminalCodexThread,terminalClaudeStream} from './sdk-terminal.ts';
import {CodexAdapter,ClaudeAdapter} from './adapters.ts';
import type {Codex,CodexOptions} from '@openai/codex-sdk';
import type {query} from '@anthropic-ai/claude-agent-sdk';
import type {SDKBundle} from './sdk-execution.ts';
import type {WorkerProfile} from './worker-profiles.ts';
export type SDKLoaders={codex:(options:CodexOptions)=>Promise<Pick<Codex,'startThread'>>;claude:()=>Promise<typeof query>};
const loaders:SDKLoaders={codex:async options=>new (await import('@openai/codex-sdk')).Codex(options),claude:async ()=>(await import('@anthropic-ai/claude-agent-sdk')).query};
// Only called inside the confined worker after protocol/activation checks.
export function executionAdapter(profile:WorkerProfile,bundle:SDKBundle,model:string,env:Record<string,string>,load:SDKLoaders=loaders){
 if(bundle.provider!==profile.provider)throw Error('Provider/profile mismatch');
 if(Object.keys(env).some(k=>/API_KEY|AUTH_TOKEN|BASE_URL|NODE_OPTIONS/.test(k)))throw Error('Forbidden worker environment');
 if(bundle.provider==='codex')return new CodexAdapter(async options=>{
  const client=await load.codex({...options,codexPathOverride:bundle.cli,env:{...env},config:{forced_login_method:'chatgpt',model_provider:'openai'}});
  return {startThread:options=>terminalCodexThread(client.startThread({...options,workingDirectory:profile.workspace}))};
 },model);
 return new ClaudeAdapter(async ()=>{
  const query=await load.claude();
  return input=>terminalClaudeStream(query({prompt:input.prompt,options:{...input.options,env:{...env},cwd:profile.workspace,pathToClaudeCodeExecutable:bundle.cli,settings:{forceLoginMethod:'claudeai'},settingSources:[],tools:[],allowedTools:[],disallowedTools:['*'],permissionMode:'dontAsk'}}),input.options.abortController?.signal);
 },model);
}
