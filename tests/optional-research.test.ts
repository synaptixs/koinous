import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {researchEvidence,researchRequest,researchAvailability,researchCoverageMarkdown} from '../src/research.ts';
import {Engine} from '../src/engine.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import {createApplication} from '../src/server.ts';
import {makeReport,composePrompt} from '../src/core.ts';
import {subscriptionEnvironment} from '../src/provider-config.ts';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';

const key='synthetic-search-service-secret';
const env={BRAVE_SEARCH_API_KEY:key};
const signal=()=>new AbortController().signal;
const wiki={query:{pages:[{pageid:42,index:1,title:'Wikipedia topic',extract:'Wikipedia background excerpt.'}]}};
const web={web:{results:[{title:'Primary source',url:'https://example.org/evidence',description:'Web search snippet.'}]}};
const both={mode:'both' as const,query:'public keywords'};
const fake:typeof fetch=async input=>Response.json(String(input).startsWith('https://en.wikipedia.org')?wiki:web);
function root(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'synqo-research-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}

test('research accepts only explicit Wikipedia/web/both choices; absent means no research',()=>{
 for(const mode of ['wikipedia','web','both'])assert.deepEqual(researchRequest({mode,query:' public '}),{mode,query:'public'});
 assert.equal(researchRequest(undefined),undefined);assert.equal(researchRequest(null),undefined);
 for(const bad of [{mode:['web'],query:'x'},{mode:'none',query:'x'},{...both,query:''},{...both,key:'secret'},{...both,url:'https://untrusted.invalid'},{...both,query:'x'.repeat(301)}])assert.throws(()=>researchRequest(bad));
 assert.deepEqual(researchAvailability({}),{wikipedia:true,web:false,webProvider:'Brave Search'});assert.equal(researchAvailability(env).web,true);assert.equal(researchAvailability({BRAVE_SEARCH_API_KEY:'bad\nheader'}).web,false);
});
test('both services receive only the explicit query; the key is sent only to Brave',async()=>{
 const requests:Array<{host:string;query:string|null}>=[];
 const load:typeof fetch=async(input,options)=>{const url=new URL(String(input)),headers=new Headers(options?.headers);requests.push({host:url.host,query:url.searchParams.get(url.host==='en.wikipedia.org'?'gsrsearch':'q')});assert.equal(options?.redirect,'error');assert.equal(options?.credentials,'omit');assert.equal(options?.body,undefined);assert.equal(headers.get('authorization'),null);
  if(url.host==='api.search.brave.com'){assert.equal(headers.get('x-subscription-token'),key);assert.equal(url.searchParams.get('count'),'5');return Response.json(web);}
  assert.equal(url.origin,'https://en.wikipedia.org');assert.equal(headers.get('x-subscription-token'),null);return Response.json(wiki);
 };
 const snapshot=await researchEvidence(both,signal(),load,env);assert.equal(requests.length,2);assert.ok(requests.every(r=>r.query===both.query));assert.equal(snapshot.items.length,2);assert.deepEqual(snapshot.research?.providers,['Wikipedia','Brave Search']);assert.deepEqual(snapshot.items.map(i=>i.researchSource),['wikipedia','web']);assert.match(snapshot.research!.scope,/full pages are not fetched/);assert.doesNotMatch(JSON.stringify(snapshot),new RegExp(key));
 assert.deepEqual(subscriptionEnvironment(env),{}); // Search credentials never enter model SDK environments.
 const repeat=await researchEvidence(both,signal(),fake,env);assert.deepEqual(snapshot,repeat);
});
test('web-only and Wikipedia-only each issue one request, and Wikipedia needs no search key',async()=>{
 for(const mode of ['web','wikipedia'] as const){let calls=0;const snapshot=await researchEvidence({mode,query:'public'},signal(),async input=>{calls++;assert.equal(new URL(String(input)).host,mode==='web'?'api.search.brave.com':'en.wikipedia.org');return Response.json(mode==='web'?web:wiki);},mode==='web'?env:{});assert.equal(calls,1);assert.equal(snapshot.items.length,1);assert.equal(snapshot.research?.mode,mode);}
});
test('missing web configuration refuses before either selected service receives a request',async()=>{
 for(const mode of ['web','both'] as const){let calls=0;await assert.rejects(researchEvidence({mode,query:'public'},signal(),async()=>{calls++;return Response.json(wiki);},{}),/not configured/);assert.equal(calls,0);}
});
test('web research caps snippets and reports retained/omitted candidates with unknown relevant total',async()=>{
 const data={web:{results:Array.from({length:8},(_,i)=>({title:'Source '+i,url:`https://example.org/${i}`,description:'x'.repeat(1200)}))}};
 const snapshot=await researchEvidence({mode:'web',query:'public'},signal(),async()=>Response.json(data),env);
 assert.equal(snapshot.items.length,5);assert.ok(snapshot.items.every(i=>i.text.length===1000));const c=snapshot.research!.coverage[0];assert.equal(c.returned,5);assert.equal(c.received,8);assert.equal(c.resultsOmitted,3);assert.equal(c.totalRelevant,null);assert.equal(c.excerptsTruncated,true);assert.match(researchCoverageMarkdown(snapshot.research).join('\n'),/5 of 8/);
});
test('web rejects unsafe/invalid/empty/oversized responses without retries or credential leakage',async()=>{
 for(const url of ['http://example.org/a','file:///private/path','https://user:password@example.org','https://localhost/a','https://127.0.0.1/a','https://service.local/a']){
  let calls=0;await assert.rejects(researchEvidence({mode:'web',query:'public'},signal(),async()=>{calls++;return Response.json({web:{results:[{url,description:'x'}]}});},env));assert.equal(calls,1);
 }
 for(const data of [{web:{results:[]}},{web:{results:'bad'}},{error:{message:key}},{web:{results:[{url:'https://example.org',description:key}]}}])await assert.rejects(researchEvidence({mode:'web',query:'public'},signal(),async()=>Response.json(data),env),e=>!String(e).includes(key));
 await assert.rejects(researchEvidence({mode:'web',query:'public'},signal(),async()=>new Response('x'.repeat(131073)),env),/128 KiB/);
 await assert.rejects(researchEvidence({mode:'web',query:'public'},signal(),async()=>new Response('not-json'),env),/Invalid research JSON/);
});
test('one selected-service failure cancels the other request and never falls back',async()=>{
 let calls=0,aborted=false;
 const load:typeof fetch=async(input,options)=>{calls++;if(new URL(String(input)).host==='en.wikipedia.org')return new Response('',{status:503});return await new Promise<Response>((_resolve,reject)=>{options!.signal!.addEventListener('abort',()=>{aborted=true;reject(Error('cancelled'));},{once:true});});};
 await assert.rejects(researchEvidence(both,signal(),load,env),/unavailable/);assert.equal(calls,2);assert.equal(aborted,true);
 const stop=new AbortController();stop.abort();calls=0;await assert.rejects(researchEvidence(both,stop.signal,load,env));assert.equal(calls,0);
});
for(const workflowMode of ['discussion','targeted'] as const)test(`${workflowMode}: both-source snapshot is shared and survives reopen/API/exports without retrieval`,async t=>{
 const dir=root(t),snapshot=await researchEvidence(both,signal(),fake,env);let retrievals=0;const prompts:string[]=[];
 const draft={recommendation:'Use a bounded pilot.',rationale:'Validate supplied facts.',claims:[],risks:['Unknown demand.'],nextSteps:['Owner: define a stop condition.']};
 const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as 'codex'|'claude',async run(prompt:string,round:1|2|3){prompts.push(prompt);return {text:workflowMode==='discussion'?'Synthetic position':JSON.stringify(round===2?{summary:'No material finding.',findings:[]}:draft),usage:{inputTokens:10,outputTokens:5,usd:null}};}})),dir,async()=>{retrievals++;return snapshot;});
 const s=engine.create('Private task',1,{providers:['codex','claude'],models:{}},{research:both,workflowMode,author:'codex',context:'Private context'});await engine.run(s);
 assert.equal(s.status,'completed');assert.equal(retrievals,1);assert.equal(s.calls,2);assert.ok(prompts.every(p=>p.includes('Wikipedia background excerpt.')&&p.includes('Web search snippet.')&&p.includes('full pages are not fetched')));assert.doesNotMatch(prompts.join('\n'),new RegExp(key));
 const reopened=new SavedSessions(dir).load(s.id)!;assert.ok(reopened);assert.deepEqual(reopened.research,both);assert.deepEqual(reopened.evidence,snapshot);assert.match(makeReport(reopened),/search-snippets|web-result snippets/);assert.match(makeReport(reopened),/Wikipedia background excerpt/);
 const app=createApplication({mode:'mock',outputDir:dir});t.after(()=>app.shutdown());
 for(const suffix of ['', '/report?format=json','/report']){let body='',status=0;await app.handler(Object.assign(Readable.from([]),{url:'/api/sessions/'+s.id+suffix,method:'GET',headers:{}}) as unknown as IncomingMessage,{writeHead(code:number){status=code;},end(text:unknown){body+=String(text);}} as unknown as ServerResponse);assert.equal(status,200);if(!suffix)assert.deepEqual(JSON.parse(body).research,both);else assert.match(body,/Web search snippet/);}
 assert.equal(retrievals,1);assert.equal(prompts.length,2);
 if(workflowMode==='discussion')assert.match(composePrompt(s,'codex',1,''),/Research scope:.*Brave Search/);
});
for(const workflowMode of ['discussion','targeted'] as const)test(`${workflowMode}: selected-source error produces zero model calls`,async t=>{
 let calls=0;const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as 'codex'|'claude',async run(){calls++;return {text:'must not run'};}})),root(t),async request=>researchEvidence(request,signal(),async()=>new Response('',{status:503}),env));
 const s=engine.create('Private task',1,{providers:['codex','claude'],models:{}},{research:both,workflowMode});await engine.run(s);assert.equal(s.status,'failed');assert.equal(calls,0);assert.equal(s.calls,0);
});
