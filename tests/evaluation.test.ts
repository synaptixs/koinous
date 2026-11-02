import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,mkdirSync,cpSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ARMS,CALLS,validateTasks,evaluationSelection,baselinePrompt,executeCell,observability,blindPackets,gradeReport,dashboardHtml} from '../src/evaluation.ts';
import type {Factory} from '../src/evaluation.ts';
import type {Adapter} from '../src/core.ts';
import {ProviderFailure} from '../src/provider-runtime.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
const tasks=validateTasks(JSON.parse(readFileSync(new URL('../evaluation/tasks.json',import.meta.url),'utf8')));
const selection=evaluationSelection({providers:['codex','codex-2'],models:{codex:'model-a','codex-2':'model-b'}});
function fixture(id:Adapter['id'],round:number){const peer=id==='codex'?'codex-2':'codex';return round===1?'Independent fixture':round===2?JSON.stringify({reviews:[{peer,decision:'unresolved',reason:'Need evidence.'}],revisedView:'Run a bounded test.',openQuestions:[]}):JSON.stringify({direction:'pilot',recommendation:'Compare retrieval methods in a bounded pilot.',rationale:'No measured gains supplied.',risks:['Evidence gap'],disagreements:['No measured ranking'],nextSteps:['Label queries and compare recall and latency.'],claims:[{id:'a1',kind:'assumption',text:'Queries can be labeled.',evidenceIds:[],snapshotId:null}],revisions:[{peer,decision:'unresolved',reason:'Need evidence.'}]});}
const factory:Factory=s=>s.providers.map(id=>({id,async run(_prompt,round){return {text:fixture(id,round),requestedModel:s.models[id]};}}));
function root(t:test.TestContext){const dir=mkdtempSync(join(tmpdir(),'koinous-eval-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
for(const arm of ARMS)test(`evaluation ${arm}: exact bounded calls, unknown usage, original text`,async t=>{
 const dir=root(t);const r=await executeCell(tasks[0],selection,arm,dir,factory,new AbortController().signal);
 assert.equal(r.calls,CALLS[arm]);assert.equal(r.status,'completed');assert.equal(r.validFinals,r.expectedFinals);
 assert.equal(observability([r]).find(x=>x.arm===arm)!.usage.inputTokens.missingCalls,CALLS[arm]);
 assert.equal(r.outputs[0].text,fixture(arm==='single-b'?'codex-2':'codex',3));
 await assert.rejects(executeCell(tasks[0],selection,arm,dir,factory,new AbortController().signal));
 if(arm==='discussion'){
  assert.equal(r.peerCoverage,true);
  const stored=join(dir,`${tasks[0].id}-${arm}`,r.sessionId!,'events.jsonl');const before=readFileSync(stored);
  const reopened=new SavedSessions(dir).load(r.sessionId!);assert.equal(reopened?.calls,6);assert.equal(reopened?.entries.length,6);assert.deepEqual(readFileSync(stored),before);
 }
});
test('same task inputs, independent prompts have no peer answers or rubric; both supported rosters',()=>{
 const prompt=baselinePrompt(tasks[0],selection,'codex');assert.ok(prompt.includes(tasks[0].question));assert.ok(prompt.includes(tasks[0].context));assert.ok(!prompt.includes(tasks[0].checks[0]));assert.match(prompt,/No successful peer responses/);
 assert.equal(evaluationSelection({providers:['codex','claude'],models:{codex:'model-a',claude:'model-c'}}).providers[1],'claude');
 assert.throws(()=>evaluationSelection({providers:['codex','codex-2'],models:{codex:'same','codex-2':'same'}}));
 assert.throws(()=>evaluationSelection({providers:['codex','grok'],models:{codex:'a',grok:'b'}}));
 assert.throws(()=>validateTasks([...tasks,tasks[0]]));
});
for(const mode of ['timeout','cancel','provider','cleanup','invalid'] as const)test(`evaluation fault ${mode} preserves evidence and stops`,async t=>{
 const dir=root(t),controller=new AbortController();let disposed=0;
 const f:Factory=s=>s.providers.map(id=>({id,async run(){if(mode==='timeout')return new Promise(()=>{});if(mode==='cancel'){controller.abort();return new Promise(()=>{});}if(mode==='provider')throw new ProviderFailure('provider_error','synthetic',{usage:{inputTokens:7}});return {text:'malformed JSON'};},async dispose(){disposed++;if(mode==='cleanup')throw Error('synthetic');}}));
 const r=await executeCell(tasks[0],selection,'independent-6',dir,f,controller.signal,10);
 if(mode==='invalid'){assert.equal(r.calls,6);assert.equal(r.validFinals,0);assert.equal(r.status,'completed');}
 else{assert.equal(r.calls,1);assert.notEqual(r.status,'completed');assert.equal(disposed,2);}
 if(mode==='provider')assert.equal(observability([r]).find(x=>x.arm==='independent-6')!.usage.inputTokens.known,7);
 if(mode==='timeout')assert.equal(r.events.find(e=>e.type==='agent.error')?.code,'timeout');
});
test('discussion provider failure aborts peers and no later round; records failed usage',async t=>{
 const f:Factory=s=>s.providers.map(id=>({id,async run(){throw new ProviderFailure('provider_error','synthetic',{usage:{inputTokens:3}});}}));
 const r=await executeCell(tasks[0],selection,'discussion',root(t),f,new AbortController().signal);
 assert.ok(r.calls<=2);assert.equal(r.peerCoverage,false);assert.notEqual(r.status,'completed');assert.equal(r.events.some(e=>e.type==='round.started'&&e.round===2),false);
});
test('blinding removes structural metadata; grading requires real complete human rows; HTML is self-contained',async t=>{
 const r=await executeCell(tasks[0],selection,'single-a',root(t),factory,new AbortController().signal);
 const b=blindPackets([r],tasks,'test salt');assert.ok(!JSON.stringify(b.packets).includes('model-a'));assert.ok(!b.packets[0].answers[0].includes('revisions'));
 const report=gradeReport(b.packets,[],b.key,true);assert.equal(report.complete,false);assert.equal(report.scores[0].mean,null);assert.match(report.conclusion,/Synthetic/);
 const row={id:b.packets[0].id,reviewer:'fixture',correctness:4,alternatives:4,actionability:4,uncertainty:4,notes:'Synthetic plumbing only'};
 assert.throws(()=>gradeReport(b.packets,[row,row],b.key,true));assert.throws(()=>gradeReport(b.packets,[{...row,correctness:5}],b.key,true));
 assert.equal(gradeReport(b.packets,[row],b.key,true).complete,false);
 assert.doesNotMatch(dashboardHtml([r],true),/<script|https?:\/\//);assert.match(dashboardHtml([r],true),/SYNTHETIC/);
});
test('preflight missing dependencies in a real isolated checkout stops before any output or adapter call',t=>{
 const dir=root(t);for(const p of ['src','scripts','evaluation','package.json','package-lock.json'])cpSync(new URL('../'+p,import.meta.url),join(dir,p),{recursive:true});
 assert.equal(spawnSync('git',['init','-q'],{cwd:dir}).status,0);
 const run=spawnSync(process.execPath,['--experimental-strip-types','scripts/evaluate.ts','preflight','evaluation/example-config.json',join(dir,'out')],{cwd:dir,env:{...process.env,KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'},encoding:'utf8'});
 assert.notEqual(run.status,0);assert.match(run.stderr,/node_modules/);
});
test('fixed development anchors span known unacceptable and acceptable rubric outcomes',()=>{
 const anchors=JSON.parse(readFileSync(new URL('../evaluation/rubric-anchors.json',import.meta.url),'utf8'));
 for(const task of tasks.filter(t=>t.split==='development')){
  const rows=anchors.filter((a:{task:string})=>a.task===task.id);
  assert.deepEqual(rows.map((a:{correctness:number})=>a.correctness),[0,4]);
  assert.ok(rows.every((a:{answer:string;reason:string})=>a.answer.length>40&&a.reason.length>40));
 }
 // Anchors are reviewer calibration data, never prompts or model-generated grades.
 assert.ok(!baselinePrompt(tasks[0],selection,'codex').includes(anchors[0].answer));
});
test('partial packets cannot pass the full matched schedule gate',async t=>{
 const r=await executeCell(tasks[0],selection,'single-a',root(t),factory,new AbortController().signal),b=blindPackets([r],tasks,'salt');
 const grades=['R1','R2'].map(reviewer=>({id:b.packets[0].id,reviewer,correctness:4,alternatives:4,actionability:4,uncertainty:4,notes:'Synthetic assertion, not empirical evidence'}));
 const report=gradeReport(b.packets,grades,b.key,true,['dev-cache','dev-queue']);assert.equal(report.complete,false);assert.equal(report.expectedPackets,10);assert.equal(report.comparisons[0].completePairs,0);
});
test('prepare failure is not counted as an attempted inference call',async t=>{
 const f:Factory=s=>s.providers.map(id=>({id,async prepare(){throw Error('synthetic');},async run(){throw Error('must not dispatch');}}));
 const r=await executeCell(tasks[0],selection,'single-a',root(t),f,new AbortController().signal);assert.equal(r.calls,0);assert.equal(r.events.some(e=>e.type==='agent.error'),false);assert.equal(r.events.some(e=>e.type==='runtime.error'),true);
});
