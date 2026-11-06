import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkSubscriptions} from '../src/subscription-setup.ts';
import type {AuthRunner,LoginProvider} from '../src/subscription-setup.ts';
import {createApplication} from '../src/server.ts';
export async function preparePersonalDiscussion(args:string[],run?:AuthRunner,log:(message:string)=>void=console.log){
 const openaiOnly=args.includes('--openai-only');
 const ollamaOnly=args.includes('--ollama-only');
 Object.assign(process.env,{MODE:'real',KOINOUS_PROVIDERS:ollamaOnly?'ollama-local,ollama-cloud':openaiOnly?'codex':'codex,claude',KOINOUS_DISABLED_PROVIDERS:ollamaOnly?'codex,claude,grok':openaiOnly?'claude,grok,ollama-local,ollama-cloud':'grok',KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'});
 if(args[0]!=='--enable-inference'||(openaiOnly&&ollamaOnly)||args.length!==((openaiOnly||ollamaOnly)?2:1)||(openaiOnly&&args[1]!=='--openai-only')||(ollamaOnly&&args[1]!=='--ollama-only'))throw Error('Real discussions are disabled. First run npm run setup (or start Ollama). When ready to use model quota, run npm run start:real -- --enable-inference, optionally with --ollama-only.');
 const candidates:LoginProvider[]=openaiOnly?['codex']:['codex','claude'];
 const ready=ollamaOnly?{codex:false,claude:false}:await checkSubscriptions(run,candidates);
 const available=candidates.filter(provider=>ready[provider]);
 if(!ollamaOnly){
  for(const provider of candidates)log(ready[provider]?`${provider}: provider account login confirmed (personal or enterprise; workspace/entitlement not verified).`:`${provider}: skipped — account login not confirmed or CLI unavailable. To enable it, run npm run setup -- login ${provider}, then restart.`);
  if(!available.length)throw Error((openaiOnly?'Codex account login is not confirmed. Sign in with npm run setup -- login codex.':'No OpenAI/Claude provider account login is confirmed. Sign in to at least one provider with npm run setup -- login codex or npm run setup -- login claude.')+' Then restart. For Ollama use npm run start:real -- --enable-inference --ollama-only; for an offline UI use npm run demo. No automatic login or API-key fallback.');
  process.env.KOINOUS_PROVIDERS=available.join(',');
  process.env.KOINOUS_DISABLED_PROVIDERS=[...(['codex','claude'] as const).filter(provider=>!ready[provider]),'grok',...(openaiOnly?['ollama-local','ollama-cloud']:[])].join(',');
 }
 const app=createApplication({mode:'real',defaults:{providers:ollamaOnly?['ollama-local','ollama-cloud']:ready.codex&&ready.claude?['codex','claude']:ready.codex?['codex','codex-2']:['claude','claude-2'],models:{codex:'',claude:'','codex-2':'','claude-2':''}}});
 process.env.KOINOUS_ENABLE_INFERENCE='1';return app;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const app=await preparePersonalDiscussion(process.argv.slice(2));const server=createServer(app.handler);
  server.on('error',error=>{process.env.KOINOUS_ENABLE_INFERENCE='0';console.error(`Startup failed: ${error.message}`);process.exitCode=1;});
  server.listen(app.port,app.host,()=>console.log(`Account discussions (personal or enterprise): http://${app.host}:${app.port}. ${process.argv.includes('--ollama-only')?'Ollama Local/Cloud; refresh models to check the daemon':'Unavailable account providers skipped; choose models from the enabled providers in the UI'}. Grok off. Starting a discussion uses model resources/quota. Costs may be unknown. Stop with Ctrl+C.`));
  const stop=()=>{process.env.KOINOUS_ENABLE_INFERENCE='0';server.close();void app.shutdown().finally(()=>server.closeAllConnections());};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }catch(error){process.env.KOINOUS_ENABLE_INFERENCE='0';console.error(error instanceof Error?error.message:'Startup failed.');process.exitCode=1;}
}
