import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseReview,responseValidation,workflowAssessment} from '../src/discussion-workflow.ts';
import {parsePosition} from '../src/discussion-outcome.ts';
import {parseClaims,validClaimAssessment,assessClaims} from '../src/claims.ts';
import {Engine} from '../src/engine.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import type {AgentId} from '../src/core.ts';
const peer={peer:'claude',decision:'adopted',reason:'Compare results.'};
const review={reviews:[peer],revisedView:'Pilot first.',openQuestions:[]};
const position={direction:'pilot',recommendation:'Pilot first.',rationale:'Learn safely.',risks:[],disagreements:[],nextSteps:['Measure results.'],revisions:[peer]};
const claim={id:'c1',kind:'assumption',text:'Feasible.',evidenceIds:[],snapshotId:null};
function check(round:number,value:unknown,path:string,actual:number,limit:number){
 const text=JSON.stringify(value),v=responseValidation({round,text})!;
 assert.equal(v.status,'invalid');assert.ok(v.issues.some(i=>i.path===path&&i.code==='too_long'&&i.actual===actual&&i.limit===limit&&i.excess===actual-limit));
 assert.equal(JSON.stringify(value),text);assert.equal(round===2?parseReview(text):parsePosition(text),null);
}
test('review and final field limits remain exact and report actual, limit and excess',()=>{
 assert.ok(parseReview(JSON.stringify({...review,revisedView:'x'.repeat(1200)})));
 for(const n of [1201,1246])check(2,{...review,revisedView:'x'.repeat(n)},'revisedView',n,1200);
 assert.ok(parsePosition(JSON.stringify({...position,revisions:[{...peer,reason:'x'.repeat(400)}]})));
 for(const n of [401,410])check(3,{...position,revisions:[{...peer,reason:'x'.repeat(n)}]},'revisions[0].reason',n,400);
 for(const key of ['recommendation','rationale'])check(3,{...position,[key]:'x'.repeat(1201)},key,1201,1200);
 for(const key of ['risks','disagreements','nextSteps'])check(3,{...position,[key]:['x'.repeat(401)]},key+'[0]',401,400);
 check(2,{...review,openQuestions:['x'.repeat(401)]},'openQuestions[0]',401,400);
 check(2,{...review,reviews:[{...peer,reason:'x'.repeat(401)}]},'reviews[0].reason',401,400);
});
test('whole-response and UTF-16 boundaries are unchanged, including fences and whitespace',()=>{
 for(const [round,value,limit] of [[2,review,5000],[3,position,12000]] as const){
  const raw='```json\n'+JSON.stringify(value)+'\n```';const exact=raw+' '.repeat(limit-raw.length);
  assert.equal(responseValidation({round,text:exact})?.status,'valid');
  const bad=responseValidation({round,text:exact+' '})!;assert.equal(bad.issues[0].path,'response');assert.equal(bad.issues[0].actual,limit+1);
 }
 assert.ok(parseReview(JSON.stringify({...review,revisedView:'😀'.repeat(600)})));
 check(2,{...review,revisedView:'😀'.repeat(600)+'x'},'revisedView',1201,1200);
 assert.equal(responseValidation({round:1,text:'unstructured'}),undefined);
});
test('claim limits and stored claim assessment retain their rejection contract',()=>{
 for(const [key,limit] of [['id',40],['text',600],['snapshotId',200]] as const){
  assert.ok(parseClaims([{...claim,[key]:'x'.repeat(limit)}]));
  check(3,{...position,claims:[{...claim,[key]:'x'.repeat(limit+1)}]},`claims[0].${key}`,limit+1,limit);
 }
 check(3,{...position,claims:[{...claim,evidenceIds:['x'.repeat(201)]}]},'claims[0].evidenceIds[0]',201,200);
 const parsed=parseClaims([claim])!;const assessment={version:1,declaredBy:['codex'],unassessed:[],scope:'Declared claims',checks:assessClaims('codex',parsed)};
 assert.ok(validClaimAssessment(assessment));assert.equal(validClaimAssessment({...assessment,checks:[{...assessment.checks[0],claim:{...claim,text:'x'.repeat(601)}}]}),false);
});
test('non-length errors expose canonical paths without echoing untrusted values',()=>{
 for(const [value,code] of [[{...review,extra:'secret'},'unknown_fields'],[{...review,reviews:[peer,peer]},'duplicate'],[{...review,openQuestions:Array(6).fill('x')},'too_many_items'],[{...review,revisedView:9},'invalid_type'],[{reviews:[]},'missing_field'],[{...review,reviews:[{...peer,decision:'secret'}]},'invalid_value']] as const){
  const v=responseValidation({round:2,text:JSON.stringify(value)})!;assert.equal(v.status,'invalid');assert.ok(v.issues.some(i=>i.code===code));assert.doesNotMatch(JSON.stringify(v),/secret/);
 }
 assert.ok(responseValidation({round:3,text:'{broken'})?.issues.some(i=>i.code==='invalid_json'));
});
test('six offline calls retain oversized originals and usage, emit diagnostics, reject coverage, and reload without rewriting evidence',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'validation-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));let calls=0;
 const original=new Map<string,string>();
 const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as AgentId,async run(_prompt:string,round:1|2|3){calls++;const p={...peer,peer:id==='codex'?'claude':'codex'};
  const text=round===1?'Independent idea':round===2?JSON.stringify({...review,reviews:[p],revisedView:'x'.repeat(id==='codex'?1246:20)}):JSON.stringify({...position,revisions:[{...p,reason:'x'.repeat(id==='claude'?410:20)}]});original.set(`${id}/${round}`,text);return {text,usage:{inputTokens:10,outputTokens:5,usd:null}};
 }})),dir);
 const s=engine.create('Synthetic idea',3);await engine.run(s);assert.equal(calls,6);assert.equal(s.calls,6);assert.equal(s.entries.length,6);
 for(const e of s.entries){assert.equal(e.text,original.get(`${e.agent}/${e.round}`));assert.equal(e.usage?.inputTokens,10);}
 assert.equal(s.events.filter(e=>e.type==='response.validated').length,4);assert.equal(s.entries.filter(e=>e.validation?.status==='invalid').length,2);
 assert.equal(workflowAssessment(s).complete,false);assert.equal(s.outcome?.status,'insufficient');assert.equal(s.spendIncomplete,true);
 assert.match(s.report!,/revisedView: 1246 characters; limit 1200; 46 over/);assert.match(s.report!,/revisions\[0\].reason: 410 characters; limit 400; 10 over/);
 const path=join(dir,s.id,'events.jsonl'),before=readFileSync(path);const saved=new SavedSessions(dir).load(s.id)!;
 assert.deepEqual(saved.entries.map(e=>e.text),s.entries.map(e=>e.text));assert.deepEqual(readFileSync(path),before);assert.equal(saved.report,s.report);
});
