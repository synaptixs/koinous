import {createServer} from 'node:http';
import {mkdirSync,cpSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createApplication} from '../src/server.ts';
import {MockAdapter} from '../src/adapters.ts';
import {SavedSessions} from '../src/saved-sessions.ts';

export const SAMPLE_ID='00000000-0000-4000-8000-000000000001';
export function prepareDemo(outputDir=resolve('runs')) {
 // Explicit overrides: never load .env or select an SDK through inherited settings.
 Object.assign(process.env,{MODE:'mock',KOINOUS_PROVIDERS:'codex,claude',KOINOUS_DISABLED_PROVIDERS:'grok',KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'});
 const source=fileURLToPath(new URL('../examples/saved-discussions/',import.meta.url));
 if(!new SavedSessions(source).load(SAMPLE_ID))throw Error('Bundled demo discussion is missing or invalid. Restore examples/saved-discussions from Git.');
 mkdirSync(outputDir,{recursive:true});
 const destination=join(outputDir,SAMPLE_ID);
 if(!existsSync(destination))cpSync(join(source,SAMPLE_ID),destination,{recursive:true,errorOnExist:true,force:false});
 if(!new SavedSessions(outputDir).load(SAMPLE_ID))throw Error('Local demo sample is incomplete or duplicated. Preserve your files and use a fresh runs directory.');
 return createApplication({mode:'mock',outputDir,defaults:{providers:['codex','claude'],models:{codex:'mock-codex',claude:'mock-claude'}},adapterFactory:(_mode,providers)=>providers!.map(id=>new MockAdapter(id))});
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try {
  const app=prepareDemo();
  const server=createServer(app.handler);
  server.on('error',error=>{console.error(`Demo could not start: ${error.message}. If the port is occupied, set PORT to another local port.`);process.exitCode=1;});
  server.listen(app.port,app.host,()=>{
   console.log(`synqo demo: http://${app.host}:${app.port}/?session=${SAMPLE_ID}`);
   console.log('Synthetic sample ready in Saved discussions. Mock Codex/Claude selected; mock Ollama choices available; Grok off; live inference disabled. No login or npm install needed.');
  });
  const stop=()=>{server.close();void app.shutdown().finally(()=>server.closeAllConnections());};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
}
