import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkSubscriptions} from '../src/subscription-setup.ts';
import type {AuthRunner} from '../src/subscription-setup.ts';
import {createApplication} from '../src/server.ts';
export async function preparePersonalDiscussion(args:string[],run?:AuthRunner){
 Object.assign(process.env,{MODE:'real',KOINOUS_PROVIDERS:'codex,claude',KOINOUS_DISABLED_PROVIDERS:'grok',KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'});
 if(args.length!==1||args[0]!=='--enable-inference')throw Error('Real discussions are disabled. First run npm run setup. When ready to use subscription quota, run npm run start:real -- --enable-inference.');
 const ready=await checkSubscriptions(run);
 if(!ready.codex||!ready.claude)throw Error('Both subscription logins must be confirmed. Run npm run setup -- status and log in again as needed. API-key fallback is disabled.');
 const app=createApplication({mode:'real',defaults:{providers:['codex','claude'],models:{codex:'',claude:''}}});
 process.env.KOINOUS_ENABLE_INFERENCE='1';return app;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const app=await preparePersonalDiscussion(process.argv.slice(2));const server=createServer(app.handler);
  server.on('error',error=>{process.env.KOINOUS_ENABLE_INFERENCE='0';console.error(`Startup failed: ${error.message}`);process.exitCode=1;});
  server.listen(app.port,app.host,()=>console.log(`Personal subscription discussions: http://${app.host}:${app.port}. Codex/Claude only; Grok off. Starting a discussion uses your subscription quota. Costs may be unknown. Stop with Ctrl+C.`));
  const stop=()=>{process.env.KOINOUS_ENABLE_INFERENCE='0';server.close();void app.shutdown().finally(()=>server.closeAllConnections());};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }catch(error){process.env.KOINOUS_ENABLE_INFERENCE='0';console.error(error instanceof Error?error.message:'Startup failed.');process.exitCode=1;}
}
