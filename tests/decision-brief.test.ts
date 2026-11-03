import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parsePosition,assessDiscussion,outcomeMarkdown,FINAL_POSITION_INSTRUCTIONS} from '../src/discussion-outcome.ts';
import {responseValidation} from '../src/discussion-workflow.ts';
import {makeReport} from '../src/core.ts';
import type {Session,Adapter} from '../src/core.ts';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createApplication} from '../src/server.ts';
import {Engine} from '../src/engine.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import {MockAdapter} from '../src/adapters.ts';
import {baselinePrompt} from '../src/evaluation.ts';
const comparison={alternative:'Keep the current process.',tradeoff:'Lower effort but slower feedback.',switchCondition:'Switch if the pilot exceeds two weeks.'};
const position={direction:'pilot',recommendation:'Run a bounded pilot.',rationale:'Measure before committing.',risks:[],disagreements:[],nextSteps:['Owner: compare after two weeks; stop on regression.'],claims:[],revisions:[],comparison};
const parse=(p:unknown)=>parsePosition(JSON.stringify(p));
function session(a:unknown,b:unknown):Session{return {id:'fixture',prompt:'Compare approaches',maxRounds:3,status:'completed',participants:['codex','claude'],entries:[{agent:'codex',round:3,text:JSON.stringify(a)},{agent:'claude',round:3,text:JSON.stringify(b)}],events:[],interventions:[],calls:2,spendKnownUSD:0,spendIncomplete:true,cancel:new AbortController()};}
test('comparison distinguishes explicit no alternative from historical absence and preserves caller data',()=>{
 assert.deepEqual(parse(position)?.comparison,comparison);
 const none={...position,comparison:{...comparison,alternative:null}};
 assert.equal(parse(none)?.comparison?.alternative,null);
 const {comparison:_,...legacy}=position;assert.equal(parse(legacy)?.comparison,undefined);
 assert.match(outcomeMarkdown(assessDiscussion(session(legacy,legacy))).join('\n'),/Not recorded/);
 assert.match(outcomeMarkdown(assessDiscussion(session(none,none))).join('\n'),/No feasible alternative declared/);
 assert.deepEqual(position.comparison,comparison);
});
test('comparison rejects malformed declarations without silently dropping them',()=>{
 for(const invalid of [null,[],{}, {...comparison,alternative:3},{...comparison,alternative:''},{...comparison,tradeoff:' '},{...comparison,switchCondition:false},{alternative:'x',tradeoff:'y'},{...comparison,extra:true}])assert.equal(parse({...position,comparison:invalid}),null,JSON.stringify(invalid));
});
test('comparison prose overruns warn without truncation; total response cap remains blocking',()=>{
 for(const field of ['alternative','tradeoff','switchCondition']){
  const text=JSON.stringify({...position,comparison:{...comparison,[field]:'😀'.repeat(201)}});
  const result=responseValidation({round:3,text});assert.equal(result?.status,'warning');
  assert.ok(result?.issues.some(i=>i.path==='comparison.'+field&&i.actual===402&&i.limit===400));
  assert.equal((parsePosition(text)?.comparison as any)[field],'😀'.repeat(201));
 }
 assert.equal(parse({...position,comparison:{...comparison,tradeoff:'x'.repeat(12000)}}),null);
});
test('comparison differences prevent agreement and preserve attribution, missing and invalid positions',()=>{
 const other={...position,comparison:{...comparison,switchCondition:'Switch only if demand disappears.'}};
 const outcome=assessDiscussion(session(position,other));assert.equal(outcome.status,'direction-alignment');
 assert.ok(outcome.unresolved.some(x=>x.text.includes('Comparison')));
 assert.equal(outcome.positions[0].position.comparison?.switchCondition,comparison.switchCondition);
 assert.equal(outcome.positions[1].position.comparison?.switchCondition,other.comparison.switchCondition);
 assert.equal(assessDiscussion(session(position,position)).status,'agreement');
 const broken=assessDiscussion(session(position,{...other,comparison:null}));assert.deepEqual(broken.invalid,['claude']);assert.equal(broken.coverage.valid,1);
 const missing=session(position,position);missing.entries.pop();assert.deepEqual(assessDiscussion(missing).missing,['claude']);
});
test('brief export escapes markup, retains peer reasons and original answers without inventing changes',()=>{
 const p={...position,comparison:{...comparison,alternative:'<script>do not execute</script>'},revisions:[{peer:'claude',decision:'rejected',reason:'Unchanged: the critique adds no material evidence.'}]};
 const s=session(p,position),text=s.entries[0].text;
 const report=makeReport(s);assert.match(report,/&lt;script&gt;do not execute&lt;\/script&gt;/);
 assert.match(report,/Unchanged: the critique adds no material evidence/);assert.ok(report.includes(text));
 assert.match(report,/not independently verified/);assert.deepEqual(s.entries[0].text,text);
});
test('new final prompt and standalone baseline request the same comparison; mock supplies it without inference',async()=>{
 const prompt=baselinePrompt({id:'dev-example',split:'development',question:'Compare plans',context:'Synthetic',checks:['a','b','c']},{providers:['codex','claude'],models:{}},'codex');
 assert.ok(prompt.includes(FINAL_POSITION_INSTRUCTIONS));assert.match(prompt,/"comparison"/);assert.match(prompt,/No peer response was supplied/);
 const result=await new MockAdapter('codex').run('PROBLEM:\nCompare plans',3,new AbortController().signal);
 assert.ok(parsePosition(result.text)?.comparison);assert.equal(result.usage?.inputTokens,0);
});
test('new saved briefs round-trip unchanged; legacy omission loads; malformed stored comparison fails closed',async t=>{
 const root=mkdtempSync(join(tmpdir(),'decision-brief-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let calls=0;const adapters:Adapter[]=['codex','claude'].map(id=>({id:id as Adapter['id'],async run(_prompt,round){calls++;return {text:round===3?JSON.stringify(position):'Synthetic initial/review response'};}}));
 const engine=new Engine(()=>adapters,root);const s=engine.create('Synthetic brief',3,{providers:['codex','claude'],models:{}});await engine.run(s);assert.equal(calls,6);
 const path=join(root,s.id,'events.jsonl'),reportPath=join(root,s.id,'report.md');const bytes=readFileSync(path),reportBytes=readFileSync(reportPath);
 const store=new SavedSessions(root),loaded=store.load(s.id)!;assert.ok(loaded);assert.deepEqual(loaded.outcome,s.outcome);assert.deepEqual(loaded.outcome?.positions[0].position.comparison,comparison);
 assert.match(makeReport(loaded,{preserveRecordedOutcome:true}),/Switch if the pilot exceeds two weeks/);assert.equal(calls,6);assert.deepEqual(readFileSync(path),bytes);assert.deepEqual(readFileSync(reportPath),reportBytes);
 const app=createApplication({mode:'real',outputDir:root,adapterFactory:()=>{throw Error('Saved access must not create adapters');}});t.after(()=>app.shutdown());
 for(const [url,expected] of [[`/api/sessions/${s.id}`,comparison.switchCondition],[`/api/sessions/${s.id}/report`,comparison.switchCondition],[`/api/sessions/${s.id}/report?format=original`,reportBytes.toString()]] as const){
  const req=Object.assign(Readable.from([]),{url,method:'GET',headers:{}});let status=0,body='';
  const res={writeHead(code:number){status=code;return this;},write(chunk:string){body+=chunk;return true;},end(chunk?:string){body+=chunk||'';return this;}};
  await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);assert.equal(status,200);assert.ok(body.includes(expected));
  if(url.endsWith('original'))assert.equal(body,reportBytes.toString());
 }
 assert.deepEqual(readFileSync(path),bytes);assert.deepEqual(readFileSync(reportPath),reportBytes);assert.equal(calls,6);
 const events=bytes.toString().trim().split('\n').map(x=>JSON.parse(x));
 for(const e of events){if(e.outcome)for(const p of e.outcome.positions)delete p.position.comparison;if(e.type==='agent.completed'&&e.round===3){const p=JSON.parse(e.text);delete p.comparison;e.text=JSON.stringify(p);}}
 const old=events.map(e=>JSON.stringify(e)).join('\n');writeFileSync(path,old);
 const legacy=store.load(s.id)!;assert.ok(legacy);assert.equal(legacy.outcome?.positions[0].position.comparison,undefined);assert.match(makeReport(legacy,{preserveRecordedOutcome:true}),/Not recorded/);assert.equal(readFileSync(path,'utf8'),old);
 events.find(e=>e.type==='discussion.assessed').outcome.positions[0].position.comparison={...comparison,switchCondition:[]};writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n'));const bad=readFileSync(path);assert.equal(store.load(s.id),undefined);assert.deepEqual(readFileSync(path),bad);
});
