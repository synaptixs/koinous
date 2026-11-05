import {tokenAccounting} from './token-accounting.ts';
import {ollamaModels,isOllama} from './ollama.ts';
import {PARTICIPANTS,providerFor} from './participants.ts';
import {workflowAssessment,responseValidation} from './discussion-workflow.ts';
import {createServer} from 'node:http';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {pathToFileURL} from 'node:url';
import {historyQuery,historyPage} from './saved-history.ts';
import {SavedSessions,sessionSummary,TERMINAL} from './saved-sessions.ts';
import {modelDefaults, resolveSelection, defaultParticipants} from './selection.ts';
import type {Selection} from './selection.ts';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Engine} from './engine.ts';
import {createAdapters} from './adapters.ts';
import {enabledProviders,assertProvidersEnabled} from './provider-config.ts';
import {usageSummary} from './provider-runtime.ts';
import {boundedInt,makeReport,originalMarkdown,PROVIDER_LABELS} from './core.ts';

export function createApplication(options: {mode?: string; outputDir?: string; defaults?: Selection; port?: number; adapterFactory?: typeof createAdapters; ollamaFetch?:typeof fetch} = {}) {
const port=options.port ?? boundedInt(process.env.PORT,3030,1,65535);
const host='127.0.0.1';
const mode=options.mode || process.env.MODE || 'mock';
if(!['mock','real'].includes(mode))throw new Error('MODE must be mock or real');
const initial:Selection=options.defaults ?? {providers: defaultParticipants(), models: modelDefaults()};
const defaults=Object.freeze({providers:Object.freeze([...initial.providers]),models:Object.freeze({...initial.models})});
const providers=[...resolveSelection(undefined,defaults,true).providers];
assertProvidersEnabled(providers);
const factory=options.adapterFactory ?? createAdapters;
const outputDir=options.outputDir ?? resolve('runs');
const engine=new Engine((session,stage)=>factory(mode,session.selection!.providers,session.selection!.models,stage?.effort,stage?.effort,!!stage),outputDir);
const saved=new SavedSessions(outputDir);
const html=readFileSync(new URL('../public/index.html',import.meta.url));
const script=readFileSync(new URL('../public/app.js',import.meta.url));
function json(res:any,code:number,obj:any){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));}
async function body(req:any){let s='';for await (const chunk of req){s+=chunk;if(s.length>16000)throw new Error('Request body too large');}return JSON.parse(s || '{}');}
let stopping=false;
const active=new Set<Promise<void>>();
async function shutdown(){stopping=true;for(const s of engine.sessions.values())engine.cancel(s);await Promise.allSettled([...active]);}
const handler=async(req:IncomingMessage,res:ServerResponse)=>{
  const url=new URL(req.url||'/',`http://${host}:${port}`);
  try{
    // Do not accept browser cross-origin POSTs to this localhost service.
    if(req.method==='POST'&&req.headers.origin){const origin=new URL(req.headers.origin);if(!(['localhost','127.0.0.1'].includes(origin.hostname)&&Number(origin.port)===port)){return json(res,403,{error:'Origin denied'});}}
    if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'"});return res.end(html);}
    if(req.method==='GET'&&url.pathname==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});return res.end(script);}
    if(req.method==='GET'&&url.pathname==='/api/models'){
      const provider=url.searchParams.get('provider')||'';
      if(!isOllama(provider)||!enabledProviders().includes(provider))return json(res,400,{error:'Choose an enabled Ollama provider'});
      // Explicit metadata refresh only; mock mode must not touch a real daemon.
      if(mode==='mock')return json(res,200,{provider,models:provider==='ollama-local'?['demo-local:small','demo-local:large']:['demo-cloud:small','demo-cloud:large'],total:2,truncated:false,unsupported:0,source:'mock',inferencePerformed:false});
      try{return json(res,200,await ollamaModels(provider,options.ollamaFetch));}
      catch{return json(res,503,{error:'Ollama model list unavailable. Start Ollama and register models, then refresh. No inference was requested.'});}
    }
    if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',mode,agents:providers,availableProviders:enabledProviders().map(id=>({id,label:PROVIDER_LABELS[id],defaultModel:defaults.models[id] || ''})),availableParticipants:PARTICIPANTS.filter(id=>enabledProviders().includes(providerFor(id))).map(id=>({id,provider:providerFor(id),modelDiscovery:isOllama(providerFor(id)),group:isOllama(providerFor(id))?'ollama':undefined,requiresInstalledModel:providerFor(id)==='ollama-local',effortMode:isOllama(providerFor(id))?'model-default':'role',label:PROVIDER_LABELS[providerFor(id)]+(id===providerFor(id)?' · Participant 1':' · Participant 2'),defaultModel:defaults.models[id]||''})),authentication:mode==='real'?'subscription':'mock',inferenceEnabled:mode==='mock'||process.env.KOINOUS_ENABLE_INFERENCE==='1',maxRounds:3,maxCalls:providers.length*3,readOnly:true});
    if(req.method==='GET'&&url.pathname==='/api/sessions'){
      const query=historyQuery(url.searchParams);
      const found=saved.list();
      const byId=new Map(found.sessions.map(s=>[s.id,s]));
      for(const s of engine.sessions.values())if(TERMINAL.has(s.status))byId.set(s.id,sessionSummary(s));
      return json(res,200,historyPage([...byId.values()],query,found.unavailable,found.truncated));
    }
    if(req.method==='POST'&&url.pathname==='/api/sessions'){
      if(stopping)return json(res,503,{error:'Application is shutting down'});
      const d=await body(req);
      if(stopping)return json(res,503,{error:'Application is shutting down'});
      const selection=resolveSelection(d.selection,defaults);
      assertProvidersEnabled(selection.providers);
      // Constructing adapters validates transport/configuration but starts no subprocesses.
      factory(mode,selection.providers,selection.models);
      if(mode==='real'&&process.env.KOINOUS_ENABLE_INFERENCE!=='1')throw Error('Live inference is disabled; set KOINOUS_ENABLE_INFERENCE=1 only for an authorized run');
      const s=engine.create(String(d.prompt || ''),boundedInt(d.maxRounds,3,1,3),selection,{context:d.context,grounding:d.grounding,budget:d.budget,research:d.research,workflowMode:d.workflowMode,author:d.author,checks:d.checks});
      json(res,201,{id:s.id,status:s.status,selection:s.selection});const running=engine.run(s);active.add(running);void running.then(()=>active.delete(running),()=>active.delete(running));return;
    }
    const match=url.pathname.match(/^\/api\/sessions\/([a-f0-9-]+)(?:\/(events|interventions|cancel|report))?$/);
    if(!match)return json(res,404,{error:'Not found'});
    const activeSession=engine.sessions.get(match[1]);
    const s=activeSession??saved.load(match[1]);if(!s)return json(res,404,{error:'Saved session unavailable, incomplete, or invalid'});
    if(req.method!=='GET'&&(!activeSession||TERMINAL.has(s.status)))return json(res,409,{error:'Finished discussions are read-only; start a new discussion to continue'});
    const action=match[2];
    if(req.method==='GET'&&!action)return json(res,200,{id:s.id,status:s.status,readOnly:!activeSession||TERMINAL.has(s.status),maxRounds:s.maxRounds,prompt:s.prompt,context:s.context,grounding:s.grounding,research:s.research,outcome:s.outcome??null,workflowMode:s.workflowMode??'discussion',targeted:s.targeted??null,targetedConfig:s.targetedConfig,tokenAccounting:tokenAccounting(s.events),workflow:s.workflowMode==='targeted'?null:workflowAssessment(s),participants:s.participants,selection:s.selection,maxCalls:s.budget?.policy.maxCalls??(s.participants?s.participants.length*s.maxRounds:null),calls:s.calls,budget:s.budget??null,spendKnownUSD:s.spendKnownUSD,spendIncomplete:s.spendIncomplete,evidence:s.evidence?{id:s.evidence.snapshotId,hash:s.evidence.hash}:null,entries:s.entries.map(entry=>({...entry,validation:s.workflowMode==='targeted'?undefined:responseValidation(entry)})),failures:s.events.filter(e=>['agent.error','budget.denied','discussion.stopped','session.error'].includes(e.type)),usage:usageSummary(s.events)});
    if(req.method==='GET'&&action==='report'){
      if(url.searchParams.get('format')==='json'){
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="review-${s.id}.json"`,'Cache-Control':'no-store'});
        return res.end(JSON.stringify({id:s.id,status:s.status,prompt:s.prompt,context:s.context,workflowMode:s.workflowMode??'discussion',research:s.research,targetedConfig:s.targetedConfig,targeted:s.targeted,selection:s.selection,evidence:s.evidence,durationMs:s.events.at(-1)?.durationMs??null,calls:s.calls,budget:s.budget,tokenAccounting:tokenAccounting(s.events),entries:s.entries,failures:s.events.filter(e=>['agent.error','discussion.stopped','session.error'].includes(e.type))},null,2));
      }
      const original=url.searchParams.get('format')==='original';
      const report=!TERMINAL.has(s.status)?'# Discussion still in progress\n':original?s.report:makeReport(s,{preserveRecordedOutcome:true})+(!activeSession&&s.report?'\n## Original saved report\n\nPreserved verbatim for historical evidence and audit details; the readable sections above are a presentation of recorded data.\n\n'+originalMarkdown(s.report)+'\n':'');
      res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="discussion-${s.id}${original?'-original':''}.md"`,'Cache-Control':'no-store'});
      return res.end(report||'# Original report unavailable\n');
    }
    if(req.method==='POST'&&action==='interventions'){const d=await body(req);engine.intervene(s,String(d.message||''));return json(res,200,{ok:true});}
    if(req.method==='POST'&&action==='cancel'){engine.cancel(s);return json(res,200,{ok:true});}
    if(req.method==='GET'&&action==='events'){
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
      const last=Math.max(0,Number(req.headers['last-event-id']||url.searchParams.get('after')||0)||0);
      const send=(event:any)=>res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
      for(const e of s.events.filter(x=>x.seq>last))send(e);
      if(['completed','partial','failed','cancelled'].includes(s.status)){return res.end();}
      const on=(e:any)=>{send(e);if(e.type==='session.finished'){engine.off(s.id,on);res.end();}};
      engine.on(s.id,on);req.on('close',()=>engine.off(s.id,on));return;
    }
    return json(res,405,{error:'Method not allowed'});
  }catch(e){return json(res,400,{error:String(e instanceof Error?e.message:e)});}
};
return {engine,handler,shutdown,port,host,mode};
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const app=createApplication();
  const server=createServer(app.handler).listen(app.port,app.host,()=>console.log(`Riff (${app.mode}) at http://${app.host}:${app.port}`));
  let shuttingDown=false;
  const stop=()=>{if(shuttingDown)return;shuttingDown=true;server.close();void app.shutdown().finally(()=>server.closeAllConnections());};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
