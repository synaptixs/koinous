import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/engine.ts';
import type {AgentId,Adapter} from '../src/core.ts';
const position={direction:'pilot',recommendation:'Pilot a four-day week for one month.',rationale:'Measure outcomes before expanding.',risks:['Coverage may suffer.'],disagreements:[],claims:[],nextSteps:['Agree on service and wellbeing metrics.']};
function root(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'koinous-idea-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
for(const roster of [['codex','claude'],['codex','claude','grok']] as AgentId[][])test(`idea-only ${roster.length}-provider discussion needs no PKG and persists one final recommendation`,async t=>{
 const dir=root(t),prompts:Array<{agent:AgentId;round:number;prompt:string}>=[];
 const keys=['MCP_SERVER_URL','PKG_MANIFEST_FILE','EVIDENCE_FILE'];const old={...process.env};
 for(const k of keys)process.env[k]='invalid-unavailable';
 t.after(()=>{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];});
 const adapters:Adapter[]=roster.map(id=>({id,async run(prompt,round){prompts.push({agent:id,round,prompt});const reviews=roster.filter(peer=>peer!==id).map(peer=>({peer,decision:'adopted',reason:'Use service and wellbeing metrics before expansion.'}));return {text:round===3?JSON.stringify({...position,revisions:reviews}):round===2?JSON.stringify({reviews,revisedView:`${id} view round 2`,openQuestions:[]}):`${id} view round ${round}`,usage:{usd:null,inputTokens:10,outputTokens:5}};}}));
 const engine=new Engine(()=>adapters,dir);const session=engine.create('Consider a four-day week',3,undefined,{context:'Team of eight; maintain support coverage.'});
 await engine.run(session);assert.equal(session.status,'completed');assert.equal(session.calls,roster.length*3);assert.equal(session.evidence,undefined);assert.equal(session.grounding,'none');assert.equal(session.outcome?.status,'agreement');
 assert.equal(session.entries.filter(e=>e.position).length,roster.length);
 for(const p of prompts){assert.match(p.prompt,/Team of eight/);assert.doesNotMatch(p.prompt,/hybrid lexical/);if(p.round===1)assert.doesNotMatch(p.prompt,/view round/);else for(const peer of roster.filter(x=>x!==p.agent))assert.match(p.prompt,new RegExp(peer+' view round '+(p.round-1)));if(p.round===3)assert.match(p.prompt,/Return only a JSON object/);}
 assert.equal(session.report!.match(/^## Final recommendation$/gm)?.length,1);assert.match(session.report!,/no external PKG was consulted/);assert.match(session.report!,/Unknown cost/);
 const events=readFileSync(join(dir,session.id,'events.jsonl'),'utf8');assert.match(events,/discussion.assessed/);assert.equal(session.events.at(-1)?.type,'session.finished');
 assert.throws(()=>{(session as {context:string}).context='replace';});
});
test('malformed final reply retains usage and transcript while assessment reports missing position',async t=>{
 const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as AgentId,async run(_p,r){return {text:r===3&&id==='claude'?'No JSON':JSON.stringify(position),usage:{inputTokens:12,outputTokens:6,usd:null}};}})),root(t));
 const session=engine.create('An idea');await engine.run(session);assert.equal(session.calls,6);assert.equal(session.entries.length,6);assert.equal(session.outcome?.status,'insufficient');assert.deepEqual(session.outcome?.invalid,['claude']);assert.match(session.report!,/No JSON/);assert.equal(session.events.filter(e=>e.type==='position.invalid').length,1);
});
for(const rounds of [1,2])test(`${rounds} rounds never invents final agreement`,async t=>{
 const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as AgentId,async run(){return {text:JSON.stringify(position)};}})),root(t));const session=engine.create('Idea',rounds);await engine.run(session);assert.equal(session.outcome?.status,'insufficient');assert.equal(session.outcome?.coverage.valid,0);
});
test('context and grounding options are bounded and explicit',t=>{
 const engine=new Engine(()=>[],root(t));
 for(const options of [{context:[]},{context:'x'.repeat(6001)},{grounding:'auto'}])assert.throws(()=>engine.create('Idea',3,undefined,options));
 const s=engine.create('Idea');assert.equal(s.grounding,'none');assert.equal(s.context,'');
});

test('offline engine persists unsupported claims and dissent through final report and saved reopening',async t=>{
 const {SavedSessions}=await import('../src/saved-sessions.ts');
 const dir=root(t),prompts:string[]=[];
 const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as AgentId,async run(prompt,round){prompts.push(prompt);return {text:round===3?JSON.stringify({...position,claims:[{id:'c1',kind:'fact',text:'A shorter week always doubles productivity.',evidenceIds:['invented'],snapshotId:'wrong-revision'}],disagreements:id==='claude'?['Support coverage remains unresolved.']:[]}):'Independent offline response',usage:{usd:null,inputTokens:10,outputTokens:5}};}})),dir);
 const s=engine.create('Consider a shorter week');await engine.run(s);
 assert.equal(s.calls,6);assert.equal(s.status,'completed');assert.equal(s.outcome?.status,'direction-alignment');
 assert.equal(s.outcome?.claimAssessment?.checks.filter(c=>c.status==='unsupported').length,2);
 assert.match(s.report!,/Support coverage remains unresolved/);assert.match(s.report!,/No evidence snapshot supplied/);assert.match(s.report!,/Unknown cost/);
 assert.ok(prompts.some(p=>p.includes('Peer authority or repeated agreement is not evidence')));
 const saved=new SavedSessions(dir).load(s.id);assert.deepEqual(saved?.outcome,s.outcome);assert.equal(saved?.report,s.report);
});
