import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createApplication} from '../src/server.ts';
import type {ParticipantId} from '../src/participants.ts';
import type {CatalogProvider,ModelCatalog} from '../src/model-catalog.ts';
process.env.EVIDENCE_FILE=new URL('../examples/demo-evidence.json',import.meta.url).pathname;
delete process.env.MCP_SERVER_URL;
function setup(t:test.TestContext,real=false,modelCatalog?:(provider:CatalogProvider)=>Promise<ModelCatalog>,ollamaFetch?:typeof fetch) {
 const outputDir=mkdtempSync(join(tmpdir(),'koinous-api-'));t.after(()=>rmSync(outputDir,{recursive:true,force:true}));
 const invocations:Array<{id:ParticipantId;model:string|undefined;prompt:string;round:number}>=[];
 const app=createApplication({mode:real?'real':'mock',outputDir,modelCatalog,ollamaFetch,defaults:{providers:['codex','claude'],models:{codex:'default-codex',claude:'',grok:'grok-4.7'}},...(real?{}:{adapterFactory:(_mode:string,ids:readonly ParticipantId[]=[],models:Partial<Record<ParticipantId,string>>={})=>ids.map(id=>({id,async run(prompt:string,round:1|2|3){invocations.push({id,model:models[id],prompt,round});await Promise.resolve();return {text:`${id} ${models[id]} round ${round}`,requestedModel:models[id]||undefined,usage:{usd:id==='codex'?null:0.01}};}}))})});
 async function request(path:string,method='GET',body?:unknown,origin?:string) {
  const req=Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{url:path,method,headers:origin?{origin}:{}});
  let status=0,text='';let headers:Record<string,string>={};
  const res={writeHead(code:number,h:Record<string,string>){status=code;headers=h;return this;},write(chunk:string){text+=chunk;return true;},end(chunk?:unknown){if(chunk!==undefined)text+=String(chunk);return this;}};
  await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);
  return {status,text,headers,json:()=>JSON.parse(text)};
 }
 async function finished(id:string){const s=app.engine.sessions.get(id)!;if(!['completed','failed','partial','cancelled'].includes(s.status))await new Promise<void>(resolve=>{const listener=(e:{type:string})=>{if(e.type==='session.finished'){app.engine.off(id,listener);resolve();}};app.engine.on(id,listener);});return s;}
 return {app,request,finished,invocations,outputDir};
}
test('API rejects invalid selections and authentication overrides before creating sessions',async t=>{
 const {request,app,invocations}=setup(t);
 for(const selection of [{providers:['codex']},{providers:['codex','codex']},{providers:['codex','unknown']},{providers:['codex','claude'],models:{codex:'bad\nmodel'}},{providers:['codex','claude'],apiKey:'synthetic'},{providers:['codex','claude'],transport:'api'}]){
  assert.equal((await request('/api/sessions','POST',{prompt:'Synthetic',selection})).status,400);
 }
 assert.equal(app.engine.sessions.size,0);assert.equal(invocations.length,0);
 assert.equal((await request('/api/sessions','POST',{prompt:'Synthetic'},'https://untrusted.invalid')).status,403);
});
test('provider catalogs are read-only and mock catalogs never launch provider metadata processes',async t=>{
 let metadataCalls=0;const catalog=async(provider:CatalogProvider):Promise<ModelCatalog>=>{metadataCalls++;return {provider,models:['explicit-a','explicit-b'],labels:{'explicit-a':'A'},total:2,truncated:false,omitted:0,source:provider+'-cli-catalog',availabilityVerified:false,inferencePerformed:false};};
 const real=setup(t,true,catalog);for(const provider of ['codex','claude']){const response=await real.request('/api/models?provider='+provider);assert.equal(response.status,200);assert.deepEqual(response.json().models,['explicit-a','explicit-b']);assert.equal(response.json().availabilityVerified,false);}
 assert.equal(metadataCalls,2);assert.equal(real.app.engine.sessions.size,0);const mock=setup(t,false,catalog);assert.equal((await mock.request('/api/models?provider=codex')).json().source,'mock');assert.equal(metadataCalls,2);assert.equal(mock.invocations.length,0);
});
test('catalog failures are sanitized and disabled providers cannot invoke discovery',async t=>{
 let calls=0;const {request,app}=setup(t,true,async()=>{calls++;throw Error('private-provider-token');});const failed=await request('/api/models?provider=claude');assert.equal(failed.status,503);assert.doesNotMatch(failed.text,/private-provider-token/);
 const before=process.env.KOINOUS_DISABLED_PROVIDERS;process.env.KOINOUS_DISABLED_PROVIDERS='codex';t.after(()=>{if(before===undefined)delete process.env.KOINOUS_DISABLED_PROVIDERS;else process.env.KOINOUS_DISABLED_PROVIDERS=before;});
 assert.equal((await request('/api/models?provider=codex')).status,400);assert.equal(calls,1);assert.equal(app.engine.sessions.size,0);
});
test('health reports optional research availability and enterprise account eligibility without exposing search credentials',async t=>{
 const before=process.env.BRAVE_SEARCH_API_KEY;process.env.BRAVE_SEARCH_API_KEY='synthetic-search-secret';t.after(()=>{if(before===undefined)delete process.env.BRAVE_SEARCH_API_KEY;else process.env.BRAVE_SEARCH_API_KEY=before;});
 const {request,app,invocations}=setup(t);const health=await request('/api/health');assert.equal(health.json().research.web,true);assert.deepEqual(health.json().providerAccountTypes,['personal','enterprise']);assert.equal(health.json().workspaceVerified,false);assert.doesNotMatch(health.text,/synthetic-search-secret/);assert.equal(invocations.length,0);assert.equal(app.engine.sessions.size,0);
});
test('UI serves current synqo branding and prevents stale HTML and script caching',async t=>{
 const {request,app,invocations}=setup(t);
 const page=await request('/');assert.equal(page.status,200);assert.equal(page.headers['Cache-Control'],'no-store');
 assert.match(page.text,/<title>synqo · Collaborative research<\/title>/);
 assert.match(page.text,/<h1>synqo<\/h1>/);assert.match(page.text,/>Collaborative research<\/span>/);
 assert.match(page.text,/<nav[^>]+aria-label="Workspace"/);assert.match(page.text,/id="navNew"/);assert.match(page.text,/id="navSaved"/);
 const ids=[...page.text.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);assert.equal(new Set(ids).size,ids.length,'Control IDs must stay unique');
 assert.doesNotMatch(page.text,/Shared inquiry|Better ideas together/i);
 const script=await request('/app.js');assert.equal(script.status,200);assert.equal(script.headers['Cache-Control'],'no-store');
 assert.equal(app.engine.sessions.size,0);assert.equal(invocations.length,0);
});
test('health offers bounded cloud setup guidance for the configured daemon without starting models',async t=>{
 const before=process.env.KOINOUS_OLLAMA_URL;process.env.KOINOUS_OLLAMA_URL='http://localhost:12444';t.after(()=>{if(before===undefined)delete process.env.KOINOUS_OLLAMA_URL;else process.env.KOINOUS_OLLAMA_URL=before;});
 const {request,app,invocations}=setup(t);const response=await request('/api/health'),guidance=response.json().ollamaCloudSetup;
 assert.equal(response.status,200);assert.equal(guidance.endpoint,'http://localhost:12444');assert.equal(guidance.examples.length,3);assert.ok(guidance.examples.every((example:{registerCommand:string})=>example.registerCommand.startsWith("OLLAMA_HOST='http://localhost:12444' ")));assert.equal(app.engine.sessions.size,0);assert.equal(invocations.length,0);
});
test('disabled cloud provider exposes no cloud setup metadata',async t=>{
 const before=process.env.KOINOUS_DISABLED_PROVIDERS;process.env.KOINOUS_DISABLED_PROVIDERS='ollama-cloud';t.after(()=>{if(before===undefined)delete process.env.KOINOUS_DISABLED_PROVIDERS;else process.env.KOINOUS_DISABLED_PROVIDERS=before;});
 const {request}=setup(t);const health=(await request('/api/health')).json();assert.equal(Object.hasOwn(health,'ollamaCloudSetup'),false);assert.ok(!health.availableParticipants.some((p:{provider:string})=>p.provider==='ollama-cloud'));
});
test('API exposes defaults and script; concurrent discussions retain independent rosters/models, events and reports',async t=>{
 const {request,finished,invocations,outputDir}=setup(t);
 const health=(await request('/api/health')).json();assert.equal(health.availableProviders.length,5);assert.deepEqual(health.agents,['codex','claude']);assert.equal(health.availableProviders[0].defaultModel,'default-codex');
 assert.match((await request('/')).text,/script src="\/app.js"/);assert.match((await request('/app.js')).text,/Choose at least two/);
 const choices=[{providers:['codex','claude'],models:{codex:'model-one',claude:'claude-one'}},{providers:['codex','grok'],models:{codex:'model-two',grok:'grok-two'}}];
 const responses=await Promise.all(choices.map(selection=>request('/api/sessions','POST',{prompt:'Synthetic',maxRounds:3,selection})));
 assert.ok(responses.every(r=>r.status===201));
 const sessions=await Promise.all(responses.map(r=>finished(r.json().id)));
 for(let i=0;i<sessions.length;i++){
  const s=sessions[i];assert.equal(s.calls,6);assert.equal(s.entries.length,6);assert.deepEqual(s.selection,choices[i]);
  assert.equal(s.events.find(e=>e.type==='participants.configured')?.maxCalls,6);
  const api=(await request('/api/sessions/'+s.id)).json();assert.deepEqual(api.selection,choices[i]);
  const report=readFileSync(join(outputDir,s.id,'report.md'),'utf8');assert.match(report,/6 of 6 planned/);assert.ok(report.includes(choices[i].models.codex));assert.match(report,/Codex cost: unknown/);
  const events=(await request('/api/sessions/'+s.id+'/events')).text;assert.ok(events.includes('"selection"'));assert.ok(events.includes('"type":"session.finished"'));
 }
 assert.equal(invocations.filter(x=>x.id==='codex'&&x.model==='model-one').length,3);
 assert.equal(invocations.filter(x=>x.id==='codex'&&x.model==='model-two').length,3);
 assert.ok(invocations.filter(x=>x.round>1).every(x=>x.prompt.includes('OTHER AGENTS LAST ROUND:')));
});
test('API retains backward-compatible omitted selection defaults',async t=>{
 const {request,finished}=setup(t);const response=await request('/api/sessions','POST',{prompt:'Synthetic',maxRounds:1});assert.equal(response.status,201);
 const s=await finished(response.json().id);assert.deepEqual(s.selection,{providers:['codex','claude'],models:{codex:'default-codex',claude:''}});assert.equal(s.calls,2);
});
test('real API rejects Grok API transport before any model invocation',async t=>{
 const old=process.env.GROK_TRANSPORT;process.env.GROK_TRANSPORT='api';t.after(()=>{if(old===undefined)delete process.env.GROK_TRANSPORT;else process.env.GROK_TRANSPORT=old;});
 const {request,app}=setup(t,true);const response=await request('/api/sessions','POST',{prompt:'Never dispatched',selection:{providers:['codex','grok']}});
 assert.equal(response.status,400);assert.match(response.text,/API-key fallback is disabled/);assert.equal(app.engine.sessions.size,0);
});

test('application shutdown cancels active work and waits for disposal before resolving or accepting another session',async t=>{
 const outputDir=mkdtempSync(join(tmpdir(),'koinous-shutdown-'));t.after(()=>rmSync(outputDir,{recursive:true,force:true}));
 let prepared!:()=>void;const started=new Promise<void>(r=>{prepared=r;});let release!:()=>void;let cleaning!:()=>void;
 const cleanupStarted=new Promise<void>(r=>{cleaning=r;});const cleanupGate=new Promise<void>(r=>{release=r;});
 const app=createApplication({mode:'mock',outputDir,adapterFactory:()=>['codex','claude'].map(id=>({id:id as ParticipantId,
  async prepare(signal:AbortSignal){prepared();await new Promise<void>((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});},
  async run(){throw Error('must never call');},async dispose(){cleaning();await cleanupGate;}
 }))});
 async function post(){let status=0;const req=Object.assign(Readable.from([JSON.stringify({prompt:'synthetic',selection:{providers:['codex','claude']}})]),{url:'/api/sessions',method:'POST',headers:{}});
 const res={writeHead(code:number){status=code;},end(){}};await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);return status;}
 assert.equal(await post(),201);await started;
 let closed=false;const stopping=app.shutdown().then(()=>{closed=true;});await cleanupStarted;
 assert.equal(closed,false);assert.equal(await post(),503);release();await stopping;
 const session=[...app.engine.sessions.values()][0];assert.equal(session.status,'cancelled');assert.equal(session.calls,0);assert.equal(session.events.at(-1)?.type,'session.finished');
});

test('API accepts idea/context without external grounding and returns assessed outcome',async t=>{
 const {request,finished}=setup(t);const result=await request('/api/sessions','POST',{prompt:'Try a four-day week',context:'Eight-person team'});
 assert.equal(result.status,201);const session=await finished(result.json().id);assert.equal(session.context,'Eight-person team');assert.equal(session.grounding,'none');assert.equal(session.evidence,undefined);
 const state=(await request('/api/sessions/'+session.id)).json();assert.equal(state.context,'Eight-person team');assert.equal(state.outcome.status,'insufficient');
 for(const context of [[], 'x'.repeat(6001)])assert.equal((await request('/api/sessions','POST',{prompt:'Idea',context})).status,400);
});
test('real API inference stays disabled independently of provider selection',async t=>{
 const prior=process.env.KOINOUS_ENABLE_INFERENCE;process.env.KOINOUS_ENABLE_INFERENCE='0';t.after(()=>{if(prior===undefined)delete process.env.KOINOUS_ENABLE_INFERENCE;else process.env.KOINOUS_ENABLE_INFERENCE=prior;});
 const {request,app}=setup(t,true);const result=await request('/api/sessions','POST',{prompt:'Never dispatch',selection:{providers:['codex','claude']}});assert.equal(result.status,400);assert.match(result.text,/Live inference is disabled/);assert.equal(app.engine.sessions.size,0);
});

test('API validates budget limits, enforces call caps and returns persisted budget state',async t=>{
 const {request,app,finished,invocations,outputDir}=setup(t);
 for(const budget of [{maxCalls:10},{maxCalls:0},{maxTokens:-1},{maxTokens:'20'},{other:1}])assert.equal((await request('/api/sessions','POST',{prompt:'Idea',budget})).status,400);
 assert.equal(app.engine.sessions.size,0);assert.equal(invocations.length,0);
 const created=await request('/api/sessions','POST',{prompt:'Idea',budget:{maxCalls:3}});assert.equal(created.status,201);
 const s=await finished(created.json().id);assert.equal(s.calls,2);
 const response=(await request('/api/sessions/'+s.id)).json();assert.equal(response.maxCalls,3);assert.equal(response.budget.policy.maxCalls,3);assert.equal(response.status,'partial');
 const {SavedSessions}=await import('../src/saved-sessions.ts');assert.deepEqual(new SavedSessions(outputDir).load(s.id)?.budget,response.budget);
});
test('API strict-token requests cannot silently fall back to call-only execution',async t=>{
 const {request,finished,invocations}=setup(t);
 const created=await request('/api/sessions','POST',{prompt:'Idea',budget:{maxTokens:100}});assert.equal(created.status,201);
 const s=await finished(created.json().id);assert.equal(s.calls,0);assert.equal(invocations.length,0);assert.equal(s.status,'partial');assert.equal(s.budget?.policy.maxTokens,100);assert.match(s.report!,/no verified whole-invocation/);
});
test('server budget ceilings cannot be relaxed by API clients',async t=>{
 const old=process.env.MAX_SESSION_TOKENS;process.env.MAX_SESSION_TOKENS='100';t.after(()=>{if(old===undefined)delete process.env.MAX_SESSION_TOKENS;else process.env.MAX_SESSION_TOKENS=old;});
 const {request,app}=setup(t);
 for(const budget of [{maxTokens:null},{maxTokens:101}])assert.equal((await request('/api/sessions','POST',{prompt:'Idea',budget})).status,400);
 assert.equal(app.engine.sessions.size,0);
});

test('API rejects invalid research configuration before dispatch and exposes offline workflow coverage',async t=>{
 const {request,finished,app}=setup(t);
 for(const research of [{mode:'unknown',query:'x'},{mode:'wikipedia',query:''}]){
  const r=await request('/api/sessions','POST',{prompt:'Idea',research});assert.equal(r.status,400);
 }
 assert.equal(app.engine.sessions.size,0);
 const r=await request('/api/sessions','POST',{prompt:'Idea'});const s=await finished(r.json().id);
 const loaded=(await request('/api/sessions/'+s.id)).json();assert.equal(loaded.workflow.research.status,'not-requested');assert.equal(loaded.workflow.complete,false);assert.equal(loaded.workflow.rows.length,2);
});


test('API carries explicit research query into one retrieval and returns source coverage',async t=>{
 const {request,finished}=setup(t);let searches=0;
 t.mock.method(globalThis,'fetch',async(input:unknown)=>{searches++;const url=new URL(String(input));assert.equal(url.origin,'https://en.wikipedia.org');assert.equal(url.searchParams.get('gsrsearch'),'public keywords');assert.ok(!String(input).includes('private'));return Response.json({query:{pages:[{pageid:42,index:1,extract:'Synthetic background source'}]}});});
 const r=await request('/api/sessions','POST',{prompt:'private idea',context:'private context',research:{mode:'wikipedia',query:'public keywords'}});assert.equal(r.status,201);
 const s=await finished(r.json().id);assert.equal(searches,1);assert.equal(s.calls,6);
 const api=(await request('/api/sessions/'+s.id)).json();assert.equal(api.workflow.research.status,'completed');assert.equal(api.workflow.research.sources[0].id,'wiki-42');
});

test('saved GET recomputes diagnostics from original text without rewriting stored events or report',async t=>{
 const {request,finished,app,outputDir}=setup(t);
 const created=await request('/api/sessions','POST',{prompt:'Synthetic',maxRounds:3});const s=await finished(created.json().id);
 const eventsPath=join(outputDir,s.id,'events.jsonl'),reportPath=join(outputDir,s.id,'report.md');const events=readFileSync(eventsPath),report=readFileSync(reportPath);
 app.engine.sessions.delete(s.id);
 const state=(await request('/api/sessions/'+s.id)).json();assert.equal(state.readOnly,true);assert.equal(state.entries.length,6);
 for(const e of state.entries){assert.equal(e.text,s.entries.find(x=>x.agent===e.agent&&x.round===e.round)!.text);if(e.round>1){assert.equal(e.validation.status,'invalid');assert.ok(e.validation.issues.some((i:{code:string})=>i.code==='invalid_json'));}else assert.equal(e.validation,undefined);}
 assert.deepEqual(readFileSync(eventsPath),events);assert.deepEqual(readFileSync(reportPath),report);
});

test('configured disabled Grok is hidden and rejected before dispatch while saved selections remain valid',async t=>{
 const {resolveSelection}=await import('../src/selection.ts');
 const old=process.env.KOINOUS_DISABLED_PROVIDERS;process.env.KOINOUS_DISABLED_PROVIDERS='grok';
 t.after(()=>{if(old===undefined)delete process.env.KOINOUS_DISABLED_PROVIDERS;else process.env.KOINOUS_DISABLED_PROVIDERS=old;});
 const {request,invocations,app}=setup(t);
 const health=(await request('/api/health')).json();assert.deepEqual(health.availableProviders.map((p:{id:string})=>p.id),['codex','claude','ollama-local','ollama-cloud']);
 const rejected=await request('/api/sessions','POST',{prompt:'Synthetic',selection:{providers:['codex','grok']}});
 assert.equal(rejected.status,400);assert.match(rejected.text,/disabled/);assert.equal(invocations.length,0);assert.equal(app.engine.sessions.size,0);
 assert.deepEqual(resolveSelection({providers:['codex','grok']},{providers:['codex','grok'],models:{}}).providers,['codex','grok']);
 const accepted=await request('/api/sessions','POST',{prompt:'Synthetic',maxRounds:1});assert.equal(accepted.status,201);await app.shutdown();
});

test('disabling Grok preserves reopening an existing saved Grok discussion',async t=>{
 const old=process.env.KOINOUS_DISABLED_PROVIDERS;delete process.env.KOINOUS_DISABLED_PROVIDERS;
 t.after(()=>{if(old===undefined)delete process.env.KOINOUS_DISABLED_PROVIDERS;else process.env.KOINOUS_DISABLED_PROVIDERS=old;});
 const {request,finished,outputDir}=setup(t);
 const created=(await request('/api/sessions','POST',{prompt:'Synthetic saved history',maxRounds:1,selection:{providers:['codex','grok']}})).json();
 await finished(created.id);process.env.KOINOUS_DISABLED_PROVIDERS='grok';
 const {SavedSessions}=await import('../src/saved-sessions.ts');
 const saved=new SavedSessions(outputDir).load(created.id);
 assert.ok(saved);assert.deepEqual(saved.selection?.providers,['codex','grok']);assert.equal(saved.entries.length,2);
});

test('API accepts two OpenAI model slots and applies provider disabling to aliases before dispatch',async t=>{
 const old=process.env.KOINOUS_DISABLED_PROVIDERS;process.env.KOINOUS_DISABLED_PROVIDERS='grok';t.after(()=>{if(old===undefined)delete process.env.KOINOUS_DISABLED_PROVIDERS;else process.env.KOINOUS_DISABLED_PROVIDERS=old;});
 const {request,finished,invocations,app}=setup(t);
 const health=(await request('/api/health')).json();assert.deepEqual(health.availableParticipants.map((p:{id:string})=>p.id),['codex','claude','codex-2','claude-2','ollama-local','ollama-local-2','ollama-cloud','ollama-cloud-2']);
 const selection={providers:['codex','codex-2'],models:{codex:'model-a','codex-2':'model-b'}};
 for(const models of [{},{codex:'same','codex-2':'same'}])assert.equal((await request('/api/sessions','POST',{prompt:'Synthetic',selection:{providers:selection.providers,models}})).status,400);
 assert.equal(app.engine.sessions.size,0);
 const created=await request('/api/sessions','POST',{prompt:'Synthetic',selection});assert.equal(created.status,201);
 const s=await finished(created.json().id);assert.equal(s.calls,6);assert.deepEqual(s.participants,selection.providers);assert.equal(invocations.filter(i=>i.id==='codex-2'&&i.model==='model-b').length,3);
 process.env.KOINOUS_DISABLED_PROVIDERS='claude,grok,ollama-local,ollama-cloud';
 const onlyOpenAI=(await request('/api/health')).json();assert.deepEqual(onlyOpenAI.availableProviders.map((p:{id:string})=>p.id),['codex']);assert.deepEqual(onlyOpenAI.availableParticipants.map((p:{id:string})=>p.id),['codex','codex-2']);
 const rejected=await request('/api/sessions','POST',{prompt:'Synthetic',selection:{providers:['codex','claude-2'],models:{}}});assert.equal(rejected.status,400);assert.match(rejected.text,/disabled/);
});


test('reasoning metadata route uses only injected Ollama show, preserves exact values and rejects invalid names before I/O',async t=>{
 const paths:string[]=[];const {request,app}=setup(t,true,undefined,async(url,options)=>{paths.push(String(url));assert.deepEqual(JSON.parse(String(options?.body)),{model:'local:a'});return new Response(JSON.stringify({capabilities:['completion'],thinking:{values:['low','medium','high',false,true]}}));});
 const found=await request('/api/models?provider=ollama-local&model=local:a');assert.equal(found.status,200);assert.deepEqual(found.json().values,['low','medium','high',false,true]);assert.equal(found.json().inferencePerformed,false);assert.equal(app.engine.sessions.size,0);assert.ok(paths.every(path=>path.endsWith('/api/show')));const before=paths.length;
 assert.equal((await request('/api/models?provider=ollama-local&model=bad%20model')).status,400);assert.equal(paths.length,before);assert.equal(app.engine.sessions.size,0);await app.shutdown();
});
