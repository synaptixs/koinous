import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,cpSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Engine} from '../src/engine.ts';
import {createApplication} from '../src/server.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import type {AgentId,Event} from '../src/core.ts';
const position={direction:'pilot',recommendation:'Try a small pilot',rationale:'Measure demand',risks:['Uncertain demand'],disagreements:['Length remains unresolved'],nextSteps:['Choose a metric']};
async function fixture(t:test.TestContext){
 const root=mkdtempSync(join(tmpdir(),'koinous-saved-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const nested=join(root,'historical-run');const engine=new Engine(()=>['codex','claude','grok'].map(id=>({id:id as AgentId,async run(_prompt:string,round:number){return {text:round===3?JSON.stringify(position):`${id}: synthetic response ${round}`,usage:{inputTokens:10,outputTokens:5,usd:id==='codex'?null:0.01}};}})),nested);
 const s=engine.create('Synthetic idea',3,{providers:['codex','claude','grok'],models:{codex:'test',claude:'test',grok:'test'}},{context:'Synthetic context',grounding:'none'});await engine.run(s);
 return {root,s,dir:join(nested,s.id),store:new SavedSessions(root)};
}
async function request(app:ReturnType<typeof createApplication>,path:string,method='GET'){
 const req=Object.assign(Readable.from([]),{url:path,method,headers:{}});let status=0,text='';
 const res={writeHead(code:number){status=code;return this;},write(chunk:string){text+=chunk;return true;},end(chunk?:string){text+=chunk||'';return this;}};
 await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);return {status,text,json:()=>JSON.parse(text)};
}
test('native reopening after restart preserves nine replies, assessment, usage, SSE and exact report without adapters or writes',async t=>{
 const {root,s,dir}=await fixture(t);const before=readFileSync(join(dir,'events.jsonl'));const report=readFileSync(join(dir,'report.md'),'utf8');
 const prior=process.env.KOINOUS_ENABLE_INFERENCE;process.env.KOINOUS_ENABLE_INFERENCE='0';t.after(()=>{if(prior===undefined)delete process.env.KOINOUS_ENABLE_INFERENCE;else process.env.KOINOUS_ENABLE_INFERENCE=prior;});
 let factories=0;const app=createApplication({mode:'real',outputDir:root,adapterFactory:()=>{factories++;throw Error('Must not construct providers');}});
 assert.equal((await request(app,'/api/health')).json().inferenceEnabled,false);
 assert.equal((await request(app,'/api/sessions')).json().sessions[0].id,s.id);
 const reopened=(await request(app,'/api/sessions/'+s.id)).json();assert.equal(reopened.readOnly,true);assert.equal(reopened.entries.length,9);assert.equal(reopened.calls,9);assert.deepEqual(reopened.outcome,s.outcome);assert.equal(reopened.usage.usd.missingCalls,3);assert.equal(reopened.context,s.context);
 assert.equal((await request(app,'/api/sessions/'+s.id+'/report?format=original')).text,report);
 const stream=(await request(app,'/api/sessions/'+s.id+'/events')).text;assert.equal((stream.match(/"type":"agent.completed"/g)||[]).length,9);assert.match(stream,/session.finished/);
 for(const action of ['cancel','interventions'])assert.equal((await request(app,`/api/sessions/${s.id}/${action}`,'POST')).status,409);
 assert.equal(app.engine.sessions.size,0);assert.equal(factories,0);assert.deepEqual(readFileSync(join(dir,'events.jsonl')),before);
 await app.shutdown();assert.deepEqual(readFileSync(join(dir,'events.jsonl')),before);
});
test('incomplete, corrupt, duplicate and symlink records fail closed; valid sessions remain browsable',async t=>{
 const {root,s,dir,store}=await fixture(t);
 const copy=()=>{const id=randomUUID(),path=join(root,id);cpSync(dir,path,{recursive:true});return {id,path};};
 const incomplete=copy();const raw=readFileSync(join(incomplete.path,'events.jsonl'),'utf8');writeFileSync(join(incomplete.path,'events.jsonl'),raw.trim().split('\n').slice(0,-1).join('\n'));
 const corrupt=copy();writeFileSync(join(corrupt.path,'events.jsonl'),'{broken');
 const linked=randomUUID();symlinkSync(dir,join(root,linked),'dir');
 const reportLink=copy();rmSync(join(reportLink.path,'report.md'));symlinkSync(join(dir,'report.md'),join(reportLink.path,'report.md'));
 assert.equal(store.load(incomplete.id),undefined);assert.equal(store.load(corrupt.id),undefined);assert.equal(store.load(linked),undefined);assert.equal(store.load(reportLink.id),undefined);assert.equal(store.load('../auth.json'),undefined);
 assert.equal(store.list().sessions.length,1);assert.equal(store.list().unavailable,3);
 cpSync(dir,join(root,s.id),{recursive:true});assert.equal(store.load(s.id),undefined);assert.equal(store.list().sessions.length,0);
});
test('older terminal discussions retain original report without inventing an assessment; failed outcomes remain visible',async t=>{
 const {s,dir,store}=await fixture(t);
 const events:Event[]=s.events.filter(e=>e.type!=='discussion.assessed').map((e,i)=>({...e,seq:i+1}));events.at(-1)!.status='failed';
 writeFileSync(join(dir,'events.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'));
 const loaded=store.load(s.id)!;assert.equal(loaded.status,'failed');assert.equal(loaded.outcome,undefined);assert.equal(loaded.report,s.report);
});
test('history reports bounded listings and discovers completed sessions created after application startup',async t=>{
 const {root,dir,s}=await fixture(t);const app=createApplication({mode:'real',outputDir:root});
 for(let i=0;i<51;i++)cpSync(dir,join(root,randomUUID()),{recursive:true});
 const result=(await request(app,'/api/sessions')).json();assert.equal(result.sessions.length,50);assert.equal(result.total,52);assert.equal(result.truncated,true);
 const id=randomUUID();cpSync(dir,join(root,id),{recursive:true});assert.equal((await request(app,'/api/sessions/'+id)).status,200);
 const deep=join(root,'a','b','c','d','e');mkdirSync(deep,{recursive:true});cpSync(dir,join(deep,randomUUID()),{recursive:true});assert.equal(new SavedSessions(root).list().truncated,true);
 assert.equal((await request(app,'/api/sessions/'+s.id)).json().readOnly,true);
});

test('oversized records and invalid sequence/outcome shapes are unavailable without altering their bytes',async t=>{
 const {dir,s,store}=await fixture(t);const path=join(dir,'events.jsonl');const original=readFileSync(path,'utf8');
 for(const content of ['x'.repeat(8*1024*1024+1),original.replace('"seq":1','"seq":99'),original.replace('"positions":[','"positions":null,"discarded":[')]){
  writeFileSync(path,content);assert.equal(store.load(s.id),undefined);assert.equal(readFileSync(path,'utf8'),content);
 }
});

test('API pages beyond 50 and searches older records before slicing without providers or changing saved bytes',async t=>{
 const {root,dir,s}=await fixture(t);const ids=[s.id];
 for(let i=0;i<52;i++){
  const id=randomUUID();ids.push(id);const target=join(root,id);cpSync(dir,target,{recursive:true});
  const file=join(target,'events.jsonl');const lines=readFileSync(file,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  lines[0].at=new Date(Date.UTC(2020,0,1,0,0,i)).toISOString();lines[0].prompt=i===0?'Ancient & unique idea':'Older synthetic idea';
  writeFileSync(file,lines.map(e=>JSON.stringify(e)).join('\n'));
 }
 let factories=0;const app=createApplication({mode:'real',outputDir:root,adapterFactory:()=>{factories++;throw Error('No providers');}});
 const first=(await request(app,'/api/sessions?page=1')).json(),second=(await request(app,'/api/sessions?page=2')).json();
 assert.equal(first.sessions.length,50);assert.equal(second.sessions.length,3);assert.equal(first.total,53);assert.equal(new Set([...first.sessions,...second.sessions].map(s=>s.id)).size,53);
 const search=(await request(app,'/api/sessions?q=ANCIENT%20%26%20unique')).json();assert.equal(search.total,1);assert.equal(search.sessions[0].id,ids[1]);assert.ok(second.sessions.some((s:{id:string})=>s.id===ids[1]));
 const file=join(root,ids[1],'events.jsonl');const bytes=readFileSync(file);assert.equal((await request(app,'/api/sessions/'+ids[1])).json().entries.length,9);assert.deepEqual(readFileSync(file),bytes);
 assert.equal((await request(app,'/api/sessions?page=999')).json().page,2);assert.equal((await request(app,'/api/sessions?q=absent')).json().total,0);
 for(const params of ['page=-1','pageSize=99','q='+ 'x'.repeat(201)])assert.equal((await request(app,'/api/sessions?'+params)).status,400);
 assert.equal(factories,0);assert.equal(app.engine.sessions.size,0);
});

test('saved history exposes recorded provider/model metadata and applies combined filters after restart without adapters',async t=>{
 const {root,s}=await fixture(t);let factories=0;
 const app=createApplication({mode:'real',outputDir:root,adapterFactory:()=>{factories++;throw Error('No providers');}});
 const day=s.events[0].at.slice(0,10);
 const response=(await request(app,`/api/sessions?provider=codex&model=test&from=${day}&to=${day}`)).json();
 assert.equal(response.total,1);assert.deepEqual(response.sessions[0].providers,['codex','claude','grok']);assert.equal(response.sessions[0].models.codex,'test');
 assert.equal((await request(app,'/api/sessions?provider=codex&model=not-selected')).json().total,0);
 assert.equal((await request(app,'/api/sessions?from=2026-02-30')).status,400);assert.equal(factories,0);
});

test('saved claim assessments reject malformed coverage but legacy outcomes remain unchanged',async t=>{
 const {s,dir,store}=await fixture(t);
 const path=join(dir,'events.jsonl'),raw=readFileSync(path,'utf8');
 const events=raw.trim().split('\n').map(line=>JSON.parse(line));
 const assessed=events.find(e=>e.type==='discussion.assessed');
 const original=assessed.outcome.claimAssessment;
 assessed.outcome.claimAssessment={...original,checks:[{claim:null}]};
 writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n'));assert.equal(store.load(s.id),undefined);
 delete assessed.outcome.claimAssessment;
 writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n'));
 const restored=store.load(s.id);assert.ok(restored);assert.equal(restored.outcome?.claimAssessment,undefined);assert.deepEqual(restored.outcome,assessed.outcome);assert.equal(restored.report,s.report);
});

test('history rejects malformed budget state and preserves unmetered legacy records',async t=>{
 const {s,dir,store}=await fixture(t);const path=join(dir,'events.jsonl'),events=readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 events.at(-1).budget={policy:{maxCalls:9,maxTokens:100},chargedTokens:-1};writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n'));assert.equal(store.load(s.id),undefined);
 delete events.at(-1).budget;writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n'));assert.equal(store.load(s.id)?.budget,undefined);assert.equal(store.load(s.id)?.report,s.report);
});

test('formatted download uses recorded outcome, retains original artifact and never starts providers or rewrites history',async t=>{
 const {root,s,dir}=await fixture(t);
 const path=join(dir,'events.jsonl');const events=readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 const recorded=events.find(e=>e.type==='discussion.assessed');
 recorded.outcome.recommendation='Recorded recommendation, not a fresh assessment';
 writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n')+'\n');
 const before=readFileSync(path);const original='Historical report with source excerpt and ``` nested fence\n';
 writeFileSync(join(dir,'report.md'),original);
 const app=createApplication({mode:'real',outputDir:root,adapterFactory:()=>{throw Error('No provider execution allowed');}});
 const url='/api/sessions/'+s.id+'/report';
 const download=await request(app,url);
 assert.equal(download.status,200);assert.match(download.text,/Recorded recommendation, not a fresh assessment/);
 for(const heading of ['## Final recommendation','### Next actions','### Provider reasoning','### Unresolved disagreements','### Claims and support checks'])assert.ok(download.text.includes(heading));
 assert.match(download.text,/1\. Choose a metric/);assert.match(download.text,/Unknown cost/);
 assert.ok(download.text.includes(original));assert.equal((await request(app,url)).text,download.text);
 assert.equal((await request(app,url+'?format=original')).text,original);
 assert.deepEqual(readFileSync(path),before);assert.equal(readFileSync(join(dir,'report.md'),'utf8'),original);
 // Older runs must not acquire a new agreement assessment just by downloading.
 writeFileSync(path,events.filter(e=>e.type!=='discussion.assessed').map((e,i)=>JSON.stringify({...e,seq:i+1})).join('\n')+'\n');
 const legacy=(await request(app,url)).text;
 assert.match(legacy,/No agreement assessment was recorded/);assert.doesNotMatch(legacy,/\*\*Assessment:\*\*/);
 await app.shutdown();
});
