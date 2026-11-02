import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/engine.ts';
import {ProviderFailure} from '../src/provider-runtime.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import type {Adapter,Reply,Usage} from '../src/core.ts';
function dir(t:test.TestContext){const d=mkdtempSync(join(tmpdir(),'failure-stop-'));t.after(()=>rmSync(d,{recursive:true,force:true}));return d;}
const tick=()=>new Promise<void>(r=>setImmediate(r));
for(const failureRound of [1,2,3])test(`failure in round ${failureRound} aborts peers, retains earlier originals and never admits another round`,async t=>{
 const output=dir(t);let fail!:()=>void,late!:(v:Reply)=>void,ready!:()=>void;const started=new Promise<void>(r=>ready=r);let aborted=false,disposed=0;
 const seen:number[]=[];
 const adapters:Adapter[]=['codex','claude','grok'].map(id=>({id:id as Adapter['id'],dispose:async()=>{disposed++;},async run(_p,round,signal){seen.push(round);
  if(round!==failureRound||id==='codex')return {text:`  original ${id}/${round}\n`,usage:{inputTokens:10,outputTokens:2,usd:null}};
  if(id==='grok')return new Promise<Reply>((_r,reject)=>{fail=()=>reject(new ProviderFailure('timeout','Synthetic deadline',{usage:{inputTokens:7,usd:null}}));ready();});
  signal.addEventListener('abort',()=>{aborted=true;},{once:true});return new Promise<Reply>(r=>late=r);
 }}));
 const engine=new Engine(()=>adapters,output),s=engine.create('Synthetic');const running=engine.run(s);await started;await tick();fail();await running;
 assert.equal(s.status,'partial');assert.equal(s.cancel.signal.aborted,false);assert.equal(aborted,true);assert.equal(disposed,3);assert.equal(s.calls,failureRound*3);assert.ok(seen.every(r=>r<=failureRound));
 assert.equal(s.events.filter(e=>e.type==='discussion.stopped').length,1);const stop=s.events.find(e=>e.type==='discussion.stopped')!;assert.equal(stop.agent,'grok');assert.equal(stop.code,'timeout');
 assert.equal(s.events.filter(e=>e.type==='agent.error'&&e.agent==='claude').at(-1)?.code,'cancelled');assert.equal(s.budget?.reservedTokens,0);
 const prior=s.entries.map(e=>e.text);assert.ok(prior.every(text=>text.startsWith('  original ')&&text.endsWith('\n')));const bytes=readFileSync(join(output,s.id,'events.jsonl')),report=s.report;
 late({text:'LATE RESULT',usage:{inputTokens:999,usd:1}});await tick();assert.deepEqual(s.entries.map(e=>e.text),prior);assert.deepEqual(readFileSync(join(output,s.id,'events.jsonl')),bytes);assert.equal(s.report,report);
 assert.deepEqual(new SavedSessions(output).load(s.id)?.entries.map(e=>e.text),prior);assert.match(report!,/Selected provider failed/);assert.ok(s.spendIncomplete);assert.equal((s.events.find(e=>e.type==='agent.error'&&e.agent==='grok')?.usage as Usage)?.inputTokens,7);
});
test('simultaneous provider failures produce one stop record and cleanup failure remains fatal',async t=>{
 const output=dir(t);let disposed=0;
 const engine=new Engine(()=>['codex','claude','grok'].map(id=>({id:id as Adapter['id'],async run(){throw new ProviderFailure('provider_error','synthetic');},async dispose(){disposed++;if(id==='grok')throw Error('synthetic cleanup');}})),output);
 const s=engine.create('Synthetic');await engine.run(s);assert.equal(s.status,'failed');assert.equal(s.calls,3);assert.equal(disposed,3);assert.equal(s.events.filter(e=>e.type==='discussion.stopped').length,1);assert.equal(s.events.at(-1)?.type,'session.finished');assert.match(s.report!,/cleanup unverified/);
});
test('Grok timeout stops a healthy pair after round one without a later admission',async t=>{
 const old=process.env.GROK_TIMEOUT_MS;process.env.GROK_TIMEOUT_MS='15';t.after(()=>{if(old===undefined)delete process.env.GROK_TIMEOUT_MS;else process.env.GROK_TIMEOUT_MS=old;});
 const engine=new Engine(()=>['codex','claude','grok'].map(id=>({id:id as Adapter['id'],async run(){if(id==='grok')return new Promise<Reply>(()=>{});return {text:'preserved',usage:{inputTokens:3,outputTokens:1,usd:null}};}})),dir(t));
 const s=engine.create('Synthetic');await engine.run(s);assert.equal(s.status,'partial');assert.equal(s.calls,3);assert.equal(s.entries.length,2);assert.equal(s.events.filter(e=>e.type==='round.started').length,1);assert.equal(s.budget?.unknownUsageCalls,1);assert.equal(s.outcome?.status,'insufficient');
});
