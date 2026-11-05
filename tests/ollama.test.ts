import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {OllamaAdapter,ollamaEndpoint,ollamaModels} from '../src/ollama.ts';
import {createAdapters} from '../src/adapters.ts';
import {defaultParticipants,resolveSelection} from '../src/selection.ts';
import {Engine} from '../src/engine.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import {historyQuery,historyPage} from '../src/saved-history.ts';
import {makeReport} from '../src/core.ts';
import {tokenAccounting} from '../src/token-accounting.ts';
import {createApplication} from '../src/server.ts';
import {preparePersonalDiscussion} from '../scripts/start-real.ts';

const remote={remote_host:'https://ollama.com',remote_model:'upstream-model'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
const metadata={capabilities:['completion']};
const reply={model:'local:small',done:true,done_reason:'stop',message:{role:'assistant',content:'A recommendation',thinking:'private reasoning'},prompt_eval_count:100,prompt_eval_cached_count:30,eval_count:20};
const signal=()=>new AbortController().signal;
function environment(t:test.TestContext){const before={...process.env};t.after(()=>{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);});delete process.env.KOINOUS_DISABLED_PROVIDERS;delete process.env.KOINOUS_PROVIDERS;process.env.KOINOUS_ENABLE_INFERENCE='0';process.env.GROK_BUILD_ENABLE_INFERENCE='0';}
function directory(t:test.TestContext){const root=mkdtempSync(join(tmpdir(),'koinous-ollama-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
async function request(app:ReturnType<typeof createApplication>,path:string,method='GET',body?:unknown){
 const req=Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{url:path,method,headers:{}});
 let status=0,text='';const res={writeHead(code:number){status=code;return this;},write(chunk:string){text+=chunk;return true;},end(chunk?:unknown){if(chunk!==undefined)text+=String(chunk);return this;}};
 await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);return {status,text,json:()=>JSON.parse(text)};
}

test('Ollama endpoint accepts loopback origins only',()=>{
 for(const url of ['http://127.0.0.1:11434','http://localhost:1234','http://[::1]:11434'])assert.equal(ollamaEndpoint(url),url);
 for(const url of ['https://ollama.com','http://192.168.1.2','http://localhost.evil.invalid','http://user:secret@localhost','http://localhost/path','http://localhost/?key=x','http://localhost/#x'])assert.throws(()=>ollamaEndpoint(url));
});
test('model discovery uses remote metadata, handles aliases and never invokes inference',async()=>{
 const paths:string[]=[];const load:typeof fetch=async(url,options)=>{paths.push(String(url));assert.equal(options?.method,'GET');assert.equal(options?.redirect,'error');assert.equal(options?.body,undefined);return json({models:[{name:'ordinary-local',...metadata},{name:'name-ending-cloud',...metadata},{name:'alias-without-cloud-suffix',...remote},{name:'other-remote',remote_host:'https://untrusted.invalid',remote_model:'x'},{name:'bad model'},{name:'ordinary-local'}]});};
 const local=await ollamaModels('ollama-local',load);assert.deepEqual(local.models,['name-ending-cloud','ordinary-local']);assert.equal(local.unsupported,2);
 const cloud=await ollamaModels('ollama-cloud',load);assert.deepEqual(cloud.models,['alias-without-cloud-suffix']);assert.equal(cloud.inferencePerformed,false);assert.ok(paths.every(p=>p.endsWith('/api/tags')));
});
test('discovery bounds output and honestly reports total and truncation',async()=>{
 const list=await ollamaModels('ollama-local',async()=>json({models:Array.from({length:205},(_,i)=>({name:`model-${i}`}))}));
 assert.equal(list.total,205);assert.equal(list.models.length,200);assert.equal(list.truncated,true);
 await assert.rejects(ollamaModels('ollama-local',async()=>json({models:'invalid'})),/list is invalid/);
 await assert.rejects(ollamaModels('ollama-local',async()=>new Response('x'.repeat(4_000_001))),/exceeds/);
});
test('fresh Ollama chats preserve counters and unknown cost without tools, keys or history',async()=>{
 const bodies:Array<Record<string,unknown>>=[];const paths:string[]=[];
 const load:typeof fetch=async(url,options)=>{paths.push(String(url));assert.equal(new Headers(options?.headers).has('authorization'),false);const body=JSON.parse(String(options?.body));bodies.push(body);return json(String(url).endsWith('/api/show')?metadata:reply);};
 const adapter=new OllamaAdapter('ollama-local','local:small',load);
 const first=await adapter.run('First task',1,signal()),second=await adapter.run('Second task',2,signal());
 assert.deepEqual(bodies.filter((_,i)=>paths[i].endsWith('/api/chat')),[{model:'local:small',messages:[{role:'user',content:'First task'}],stream:false},{model:'local:small',messages:[{role:'user',content:'Second task'}],stream:false}]);
 assert.deepEqual(first.usage,{inputTokens:100,outputTokens:20,cacheReadTokens:30,usd:null});assert.equal(first.requestedModel,'local:small');assert.equal(first.model,'local:small');assert.equal(first.accounting?.auxiliaryVisibility,'not-reported');assert.equal(second.text,'A recommendation');assert.doesNotMatch(JSON.stringify(first),/private reasoning/);
 const accounting=tokenAccounting([{seq:1,at:'test',type:'agent.completed',agent:adapter.id,round:1,...first}]);assert.equal(accounting.knownTotalTokens,120);assert.equal(accounting.calls[0].primaryTokens,120);assert.equal(accounting.calls[0].auxiliaryTokens,null);
});
test('Local refuses cloud aliases and Cloud refuses local or untrusted remote models before chat',async()=>{
 for(const [provider,meta] of [['ollama-local',{...metadata,...remote}],['ollama-cloud',metadata],['ollama-cloud',{...metadata,remote_host:'https://untrusted.invalid',remote_model:'x'}]] as const){
  let calls=0;const adapter=new OllamaAdapter(provider,'alias',async url=>{calls++;assert.ok(String(url).endsWith('/api/show'));return json(meta);});
  await assert.rejects(adapter.run('Private task',1,signal()));assert.equal(calls,1);
 }
});
test('Ollama refuses models without declared completion capability',async()=>{
 let calls=0;const adapter=new OllamaAdapter('ollama-local','embeddings',async()=>{calls++;return json({capabilities:['embedding']});});
 await assert.rejects(adapter.run('Task',1,signal()),/completion capability/);assert.equal(calls,1);
});
test('Cloud goes through the signed-in daemon and never requests a bearer token',async()=>{
 const adapter=new OllamaAdapter('ollama-cloud','cloud-alias',async(url,options)=>{assert.ok(String(url).startsWith('http://127.0.0.1:11434/'));assert.equal(new Headers(options?.headers).has('authorization'),false);return json(String(url).endsWith('/api/show')?{...metadata,...remote}:{...reply,...remote,model:'cloud-alias'});});
 assert.equal((await adapter.run('Task',1,signal())).requestedModel,'cloud-alias');
});
test('Ollama failures stop without retries, retain partial usage and hide upstream secrets',async()=>{
 let calls=0;const auth=new OllamaAdapter('ollama-cloud','alias',async()=>{calls++;return json({error:'SECRET',signin_url:'SECRET'},401);});
 await assert.rejects(auth.run('Task',1,signal()),e=>/ollama signin/.test(String(e))&&!String(e).includes('SECRET'));assert.equal(calls,1);
 for(const response of [{...reply,done:false},{...reply,done_reason:'length'},{...reply,message:{content:'',tool_calls:[{}]}}]){
  const adapter=new OllamaAdapter('ollama-local','local:small',async url=>json(String(url).endsWith('/api/show')?metadata:response));
  await assert.rejects(adapter.run('Task',1,signal()),(e:unknown)=>{assert.equal((e as {details:{usage:{inputTokens:number}}}).details.usage.inputTokens,100);return true;});
 }
});
test('aborted Ollama calls never dispatch and missing token usage stays unknown',async()=>{
 const abort=new AbortController();abort.abort();let calls=0;
 const adapter=new OllamaAdapter('ollama-local','local:small',async url=>{calls++;return json(String(url).endsWith('/api/show')?metadata:{...reply,prompt_eval_count:null,eval_count:undefined});});
 await assert.rejects(adapter.run('Task',1,abort.signal));assert.equal(calls,0);
 const r=await adapter.run('Task',1,signal());assert.equal(r.usage?.inputTokens,undefined);assert.equal(r.usage?.outputTokens,undefined);assert.equal(r.usage?.usd,null);
});
test('Ollama forwards in-flight cancellation to fetch and never retries',async()=>{
 const controller=new AbortController();let calls=0;
 const adapter=new OllamaAdapter('ollama-local','local:small',async(_url,options)=>{
  calls++;assert.equal(options?.signal,controller.signal);
  return await new Promise<Response>((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason),{once:true});queueMicrotask(()=>controller.abort(new Error('Cancelled by user')));});
 });
 await assert.rejects(adapter.run('Task',1,controller.signal),/Cancelled by user/);assert.equal(calls,1);
});
test('Ollama slots support mixed providers and distinct same-provider models without changing defaults',t=>{
 environment(t);assert.deepEqual(defaultParticipants(),['codex','claude','grok']);
 for(const providers of [['codex','ollama-local'],['claude','ollama-cloud'],['ollama-local','ollama-cloud'],['ollama-local','ollama-local-2']] as const){
  const models=Object.fromEntries(providers.map((id,i)=>[id,`test-${i}`]));assert.deepEqual(createAdapters('real',providers,models).map(a=>a.id),providers);
 }
 assert.throws(()=>resolveSelection({providers:['codex','ollama-local']}),/explicit Ollama/);
 assert.throws(()=>resolveSelection({providers:['ollama-local','ollama-local-2'],models:{'ollama-local':'same','ollama-local-2':'same'}}),/different model IDs/);
 process.env.KOINOUS_PROVIDERS='ollama-cloud';assert.deepEqual(defaultParticipants(),['ollama-cloud','ollama-cloud-2']);
});
test('model-list API is metadata-only with inference disabled; mock mode never contacts Ollama',async t=>{
 environment(t);let metadataCalls=0;
 const app=createApplication({mode:'real',outputDir:directory(t),ollamaFetch:async url=>{metadataCalls++;assert.ok(String(url).endsWith('/api/tags'));return json({models:[{name:'local:small'},{name:'alias',...remote}]});}});t.after(()=>app.shutdown());
 const health=(await request(app,'/api/health')).json();assert.equal(health.availableProviders.length,5);assert.equal(health.inferenceEnabled,false);assert.ok(health.availableParticipants.every((p:{modelDiscovery:boolean})=>p.modelDiscovery));
 const ollamaParticipants=health.availableParticipants.filter((p:{group:string})=>p.group==='ollama');assert.equal(ollamaParticipants.length,4);
 for(const participant of ollamaParticipants){assert.equal(participant.requiresInstalledModel,participant.provider==='ollama-local');}
 const result=await request(app,'/api/models?provider=ollama-cloud');assert.equal(result.status,200);assert.deepEqual(result.json().models,['alias']);assert.equal(metadataCalls,1);assert.equal(app.engine.sessions.size,0);
 process.env.KOINOUS_DISABLED_PROVIDERS='ollama-cloud';assert.equal((await request(app,'/api/models?provider=ollama-cloud')).status,400);assert.equal(metadataCalls,1);
 const mock=createApplication({mode:'mock',outputDir:directory(t),ollamaFetch:async()=>{throw Error('must never fetch');}});t.after(()=>mock.shutdown());
 assert.equal((await request(mock,'/api/models?provider=ollama-local')).json().source,'mock');assert.equal((await request(mock,'/api/models?provider=codex')).json().source,'mock');
});
test('targeted Ollama workflow, saved reopening, filters and exports preserve models and accounting',async t=>{
 environment(t);const root=directory(t);const draft={recommendation:'Test a bounded pilot.',rationale:'Assumption: demand can be tested.',claims:[],risks:['Unknown demand.'],nextSteps:['Owner: define a stop condition.']};
 let chats=0;const engine=new Engine(s=>s.selection!.providers.map(id=>{
  const adapter=new OllamaAdapter(id==='ollama-local'?'ollama-local':'ollama-cloud',s.selection!.models[id]!,async(url,options)=>{
   const model=JSON.parse(String(options?.body)).model;
   if(String(url).endsWith('/api/show'))return json({...metadata,...(model==='cloud-alias'?remote:{})});
   chats++;return json({...reply,model,message:{content:JSON.stringify(chats===1?draft:{summary:'No material issue found.',findings:[]})}});
  });return adapter;
 }),root);
 const selection={providers:['ollama-local','ollama-cloud'],models:{'ollama-local':'local:small','ollama-cloud':'cloud-alias'}};
 const s=engine.create('Synthetic task',3,resolveSelection(selection),{grounding:'none',workflowMode:'targeted',author:'ollama-local'});await engine.run(s);
 assert.equal(s.status,'completed');assert.equal(chats,2);assert.equal(s.calls,2);assert.equal(tokenAccounting(s.events).knownTotalTokens,240);
 process.env.KOINOUS_DISABLED_PROVIDERS='ollama-local,ollama-cloud';
 const saved=new SavedSessions(root),reopened=saved.load(s.id)!;assert.ok(reopened);assert.deepEqual(reopened.selection,selection);assert.equal(reopened.targeted?.complete,true);
 const report=makeReport(reopened);assert.match(report,/model default effort/);assert.match(report,/240 known total tokens/);assert.match(report,/cloud-alias/);assert.doesNotMatch(report,/ollama-local \(low effort\)/);
 const page=historyPage(saved.list().sessions,historyQuery(new URLSearchParams('provider=ollama-cloud&model=cloud-alias')),0,false);assert.equal(page.total,1);assert.equal(chats,2);
});
test('Ollama-only launcher needs no OpenAI/Claude auth and starts no inference',async t=>{
 environment(t);let calls=0;const app=await preparePersonalDiscussion(['--enable-inference','--ollama-only'],async()=>{calls++;throw Error('unexpected auth');});t.after(()=>app.shutdown());
 assert.equal(calls,0);assert.equal(app.engine.sessions.size,0);assert.equal(process.env.KOINOUS_PROVIDERS,'ollama-local,ollama-cloud');assert.equal(process.env.KOINOUS_DISABLED_PROVIDERS,'codex,claude,grok');
 process.env.KOINOUS_ENABLE_INFERENCE='0';
 await assert.rejects(preparePersonalDiscussion(['--enable-inference','--ollama-only','--openai-only']),/disabled/);assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'0');
});
