import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkSubscriptions,runAuth,subscriptionReady} from '../src/subscription-setup.ts';
import type {AuthRunner} from '../src/subscription-setup.ts';
import {createApplication} from '../src/server.ts';
export async function preparePersonalDiscussion(args:string[],run?:AuthRunner){
 const openaiOnly=args.includes('--openai-only');
 Object.assign(process.env,{MODE:'real',KOINOUS_PROVIDERS:openaiOnly?'codex':'codex,claude',KOINOUS_DISABLED_PROVIDERS:openaiOnly?'claude,grok':'grok',KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'});
 if(args[0]!=='--enable-inference'||args.length!==(openaiOnly?2:1)||(openaiOnly&&args[1]!=='--openai-only'))throw Error('Real discussions are disabled. First run npm run setup. When ready to use subscription quota, run npm run start:real -- --enable-inference.');
 const ready=openaiOnly?{codex:subscriptionReady('codex',await (run??runAuth)('codex','status')),claude:true}:await checkSubscriptions(run);
 if(!ready.codex||!ready.claude)throw Error((openaiOnly?'Codex subscription login must be confirmed.':'Both subscription logins must be confirmed.')+' Run npm run setup -- status and log in again as needed. API-key fallback is disabled.');
 const app=createApplication({mode:'real',defaults:{providers:openaiOnly?['codex','codex-2']:['codex','claude'],models:{codex:'',claude:'','codex-2':''}}});
 process.env.KOINOUS_ENABLE_INFERENCE='1';return app;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const app=await preparePersonalDiscussion(process.argv.slice(2));const server=createServer(app.handler);
  server.on('error',error=>{process.env.KOINOUS_ENABLE_INFERENCE='0';console.error(`Startup failed: ${error.message}`);process.exitCode=1;});
  server.listen(app.port,app.host,()=>console.log(`Personal subscription discussions: http://${app.host}:${app.port}. ${process.argv.includes('--openai-only')?'Two OpenAI models; Claude off':'Codex/Claude'}; Grok off. Starting a discussion uses your subscription quota. Costs may be unknown. Stop with Ctrl+C.`));
  const stop=()=>{process.env.KOINOUS_ENABLE_INFERENCE='0';server.close();void app.shutdown().finally(()=>server.closeAllConnections());};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }catch(error){process.env.KOINOUS_ENABLE_INFERENCE='0';console.error(error instanceof Error?error.message:'Startup failed.');process.exitCode=1;}
}
