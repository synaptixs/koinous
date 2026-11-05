import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {researchEvidence,researchRequest} from '../src/research.ts';
import {parseReview,parsePeerResponses,workflowAssessment} from '../src/discussion-workflow.ts';
import {parsePosition} from '../src/discussion-outcome.ts';
import {composePrompt} from '../src/core.ts';
import type {AgentId,Adapter} from '../src/core.ts';
import {Engine} from '../src/engine.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
const signal=()=>new AbortController().signal;
const research={mode:'wikipedia' as const,query:'four-day workweek'};
const page={pageid:42,index:1,extract:'Synthetic source: a pilot can compare working arrangements.'};
const fetchJSON=(data:unknown):typeof fetch=>async()=>Response.json(data);
const evidence=()=>researchEvidence(research,signal(),fetchJSON({query:{pages:[page]}}));
const response=(peer:AgentId)=>({peer,decision:'adopted' as const,reason:'Use a reversible pilot and compare workload, not only satisfaction.'});
const position=(peers:AgentId[])=>({direction:'pilot',recommendation:'Pilot for six weeks.',rationale:'Assume scheduling is feasible.',risks:['Work intensification'],disagreements:[],nextSteps:['Team lead: compare workload weekly; stop if service quality declines.'],claims:[{id:'c1',kind:'assumption',text:'Scheduling is feasible',evidenceIds:[],snapshotId:null}],revisions:peers.map(response)});

test('research validates explicit public query and rejects unknown configuration',()=>{
 assert.equal(researchRequest(undefined),undefined);
 assert.ok(Object.isFrozen(researchRequest(research)));
 for(const bad of [{mode:'unknown',query:'x'},{mode:'wikipedia',query:''},{...research,query:'x'.repeat(301)},{...research,url:'http://localhost'},'x'])assert.throws(()=>researchRequest(bad));
});
test('research sends only query to fixed endpoint, bounds sources and hashes shared excerpts deterministically',async()=>{
 let calls=0;
 const fetcher:typeof fetch=async(input,init)=>{calls++;const url=new URL(String(input));assert.equal(url.origin,'https://en.wikipedia.org');assert.equal(url.searchParams.get('gsrlimit'),'5');assert.equal(url.searchParams.get('gsrsearch'),research.query);assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');assert.equal(new Headers(init?.headers).get('Authorization'),null);return Response.json({query:{pages:[{...page,pageid:43,index:2},page]}});};
 const a=await researchEvidence(research,signal(),fetcher),b=await researchEvidence(research,signal(),fetcher);
 assert.equal(calls,2);assert.deepEqual(a,b);assert.deepEqual(a.items.map(x=>x.id),['wiki-42','wiki-43']);assert.equal(a.source,'web');assert.equal(a.items[0].uri,'https://en.wikipedia.org/?curid=42');
 const changed=await researchEvidence(research,signal(),fetchJSON({query:{pages:[{...page,extract:'Different evidence'}]}}));assert.notEqual(a.hash,changed.hash);
});
test('research rejects failures, empty/invalid/oversized responses and honors cancellation without fallback',async()=>{
 for(const data of [{error:{code:'limit'}},{batchcomplete:true},{query:{pages:[{...page,extract:''}]}},{query:{pages:[{...page,pageid:-1}]}},{query:{pages:[page,page]}},{query:{pages:Array(6).fill(page)}},{query:{pages:'bad'}},{padding:'x'.repeat(140000)},{query:{pages:Array.from({length:5},(_,i)=>({...page,pageid:i+1,extract:'\u0001'.repeat(1500)}))}}])await assert.rejects(researchEvidence(research,signal(),fetchJSON(data)));
 await assert.rejects(researchEvidence(research,signal(),async()=>new Response('',{status:503})));
 const controller=new AbortController();controller.abort();let called=false;await assert.rejects(researchEvidence(research,controller.signal,async()=>{called=true;throw Error('unexpected');}));assert.equal(called,false);
});
test('peer and revision schemas reject duplicate, invented and empty declarations',()=>{
 assert.ok(parsePeerResponses([response('claude')]));
 for(const value of [[response('claude'),response('claude')],[{...response('claude'),peer:'invented'}],[{...response('claude'),reason:''}],[{...response('claude'),extra:true}]])assert.equal(parsePeerResponses(value),null);
 assert.equal(parseReview('free prose'),null);assert.equal(parseReview(JSON.stringify({reviews:[],revisedView:'x',openQuestions:['']})),null);
 assert.equal(parsePosition(JSON.stringify({...position(['claude']),revisions:[response('claude'),response('claude')]})),null);
 const legacy=position([]);delete (legacy as Partial<typeof legacy>).revisions;assert.ok(parsePosition(JSON.stringify(legacy)));
});
for(const roster of [['codex','claude'],['codex','claude','grok']] as AgentId[][])test(`${roster.length} providers: research, isolated analysis, complete peer exchange, revision, report and saved reopening offline`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'idea-workflow-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const snapshot=await evidence();let researched=0;const prompts:Array<{id:AgentId;round:number;text:string}>=[];
 const adapters:Adapter[]=roster.map(id=>({id,async run(text,round){prompts.push({id,round,text});const peers=roster.filter(p=>p!==id);return {text:round===1?`${id} independent view`:round===2?JSON.stringify({reviews:peers.map(response),revisedView:`${id} updated view`,openQuestions:['Does the workload fit?']}):JSON.stringify(position(peers)),usage:{inputTokens:100,outputTokens:50,usd:null}};}}));
 const engine=new Engine(()=>adapters,dir,async()=>{researched++;return snapshot;});
 const s=engine.create('Private idea details',3,undefined,{research,context:'Private context'});await engine.run(s);
 assert.equal(researched,1);assert.equal(s.calls,roster.length*3);assert.equal(s.entries.length,s.calls);assert.equal(s.status,'completed');
 for(const p of prompts){assert.ok(p.text.includes(snapshot.snapshotId));assert.ok(p.text.includes(snapshot.items[0].text));if(p.round===1)assert.doesNotMatch(p.text,/independent view|updated view/);else for(const peer of roster.filter(x=>x!==p.id))assert.ok(p.text.includes(`${peer} ${p.round===2?'independent':'updated'} view`));}
 const w=workflowAssessment(s);assert.equal(w.complete,true);assert.equal(w.research.status,'completed');assert.ok(w.rows.every(r=>r.reviewed.length===roster.length-1&&r.responded.length===roster.length-1));
 assert.match(s.report!,/Declared review and revision coverage is complete/);assert.match(s.report!,/Unknown cost/);assert.match(s.report!,/Retrieved excerpt/);assert.match(s.report!,/Pilot for six weeks/);assert.match(s.report!,/Work intensification/);assert.match(s.report!,/stop if service quality declines/);
 const saved=new SavedSessions(dir).load(s.id)!;assert.ok(saved);assert.deepEqual(workflowAssessment(saved),w);assert.equal(saved.report,s.report);assert.equal(saved.outcome?.recommendation,s.outcome?.recommendation);
});
test('failed research dispatches no provider calls or preparation and retains a reviewable failure report',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'idea-failure-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let touched=0;
 const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as AgentId,async prepare(){touched++;},async run(){touched++;return {text:'unexpected'};}})),dir,async()=>{throw Error('No usable research sources found');});
 const s=engine.create('Idea',3,undefined,{research});await engine.run(s);assert.equal(s.status,'failed');assert.equal(touched,0);assert.equal(s.calls,0);assert.match(s.report!,/Research: unavailable/);assert.match(s.report!,/No usable research sources/);
 assert.throws(()=>engine.create('Idea',3,undefined,{research,grounding:'configured'}));
});
test('missing, self, invented and unavailable peers cannot count as complete collaboration; long excerpts are labelled',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'idea-coverage-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const engine=new Engine(()=>[],dir);const s=engine.create('Idea');s.participants=['codex','claude','grok'];
 s.entries=[{agent:'claude',round:1,text:'x'.repeat(6000)},{agent:'codex',round:2,text:JSON.stringify({reviews:[response('codex'),response('grok')],revisedView:'Pilot',openQuestions:[]})},{agent:'codex',round:3,text:JSON.stringify(position(['claude']))}];
 const w=workflowAssessment(s);assert.equal(w.complete,false);assert.equal(w.rows[0].reviewed.length,0);assert.deepEqual(w.rows[0].invalidReferences,['codex']);assert.deepEqual(w.rows[0].missingRevisions,['claude','grok']);
 assert.match(composePrompt(s,'codex',2,''),/Excerpt: 5000 of 6000 characters; remainder omitted/);
});

test('default mock app completes declared review/revision coverage without research or model inference',async t=>{
 const {MockAdapter}=await import('../src/adapters.ts');const dir=mkdtempSync(join(tmpdir(),'idea-mock-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const engine=new Engine(()=>[new MockAdapter('codex'),new MockAdapter('claude')],dir,async()=>{throw Error('Unexpected research');});
 const s=engine.create('Compare reversible choices');await engine.run(s);assert.equal(s.calls,6);assert.equal(workflowAssessment(s).complete,true);assert.equal(s.spendKnownUSD,0);
});
test('identical final positions without peer review cannot be reported as agreement by the engine',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'idea-no-review-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as AgentId,async run(){return {text:JSON.stringify({...position([]),claims:[],risks:[]})};}})),dir);
 const s=engine.create('Idea');await engine.run(s);assert.equal(s.outcome?.status,'direction-alignment');assert.match(s.outcome!.caveat,/coverage is incomplete/);
});

test('unresolved critique responses prevent agreement even when headlines and directions match',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'idea-dissent-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const roster:AgentId[]=['codex','claude'];
 const engine=new Engine(()=>roster.map(id=>({id,async run(_prompt,round){const peers=roster.filter(p=>p!==id);const reviews=peers.map(p=>({...response(p),decision:'unresolved'}));return {text:round===1?'Initial view':round===2?JSON.stringify({reviews,revisedView:'Pilot',openQuestions:[]}):JSON.stringify({...position(peers),claims:[],revisions:reviews})};}})),dir);
 const s=engine.create('Idea');await engine.run(s);assert.equal(workflowAssessment(s).complete,true);assert.equal(s.outcome?.status,'direction-alignment');assert.ok(s.outcome?.unresolved.some(x=>x.text.includes('Unresolved critique from')));
});
