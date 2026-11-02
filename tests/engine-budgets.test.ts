import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Engine} from '../src/engine.ts';
import {ProviderFailure} from '../src/provider-runtime.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import {CodexAdapter,ClaudeAdapter,MockAdapter} from '../src/adapters.ts';
import {ManagedGrokBuildAdapter} from '../src/grok-managed.ts';
import type {Adapter,Usage} from '../src/core.ts';
function fixture(t:test.TestContext,factory:()=>Adapter[]){const dir=mkdtempSync(join(tmpdir(),'koinous-budget-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return {engine:new Engine(factory,dir),dir};}
function pair(run:Adapter['run'],bound?:number):Adapter[]{return ['codex','claude'].map(id=>({id:id as Adapter['id'],maxTotalTokensPerCall:bound,run}));}

test('whole-round call admission counts failures and stops without partial extra rounds',async t=>{
 let calls=0;const {engine}=fixture(t,()=>pair(async()=>{calls++;return {text:'answer',usage:{usd:null}};}));
 const s=engine.create('Idea',3,undefined,{budget:{maxCalls:3}});await engine.run(s);
 assert.equal(calls,2);assert.equal(s.calls,2);assert.equal(s.status,'partial');assert.equal(s.budget?.admittedCalls,2);assert.match(s.report!,/Full round exceeds remaining call budget/);assert.match(s.report!,/Unknown cost/);
});
test('strict token reservations precede all simultaneous calls and reconcile known usage',async t=>{
 let calls=0;const {engine,dir}=fixture(t,()=>pair(async()=>{calls++;await Promise.resolve();return {text:'answer',usage:{inputTokens:20,outputTokens:10,usd:null}};},40));
 const s=engine.create('Idea',3,undefined,{budget:{maxTokens:100}});await engine.run(s);
 assert.equal(calls,2);assert.equal(s.budget?.chargedTokens,60);assert.equal(s.budget?.reservedTokens,0);assert.equal(s.status,'partial');
 assert.equal(s.events.find(e=>e.type==='budget.reserved')?.budget && (s.events.find(e=>e.type==='budget.reserved')!.budget as any).reservedTokens,80);
 assert.ok(s.events.findIndex(e=>e.type==='budget.reserved')<s.events.findIndex(e=>e.type==='agent.started'));
 assert.match(s.report!,/remaining token budget/);assert.deepEqual(new SavedSessions(dir).load(s.id)?.budget,s.budget);
});
test('missing or failed-call usage retains worst-case reservations without inventing costs',async t=>{
 let calls=0;const {engine}=fixture(t,()=>pair(async()=>{calls++;if(calls===1)throw new ProviderFailure('synthetic','failure',{usage:{inputTokens:5,usd:null}});return {text:'answer'};},40));
 const s=engine.create('Idea',3,undefined,{budget:{maxTokens:80}});await engine.run(s);
 assert.equal(s.calls,2);assert.equal(s.budget?.chargedTokens,80);assert.equal(s.budget?.unknownUsageCalls,2);assert.equal(s.spendKnownUSD,0);assert.equal(s.spendIncomplete,true);assert.equal(s.status,'partial');
});
test('strict unsupported adapters are denied before prepare or run and still cleaned up',async t=>{
 let prepares=0,runs=0,disposals=0;const {engine}=fixture(t,()=>pair(async()=>{runs++;return {text:'unexpected'};}).map(a=>({...a,prepare:async()=>{prepares++;},dispose:async()=>{disposals++;}})));
 const s=engine.create('Idea',3,undefined,{budget:{maxTokens:100}});await engine.run(s);
 assert.equal(prepares,0);assert.equal(runs,0);assert.equal(disposals,2);assert.equal(s.calls,0);assert.equal(s.status,'partial');assert.match(s.report!,/no verified whole-invocation token ceiling/);
});
test('actual subscription adapter capabilities do not pretend output or dollar caps bound total tokens',()=>{
 for(const a of [new CodexAdapter(),new ClaudeAdapter(),new ManagedGrokBuildAdapter()] as Adapter[])assert.equal(a.maxTotalTokensPerCall,undefined);
 assert.equal(new MockAdapter('codex').maxTotalTokensPerCall,0);
});
test('timeout keeps the full reservation, cleanup runs and late usage cannot refund it',async t=>{
 const old=process.env.MODEL_TIMEOUT_MS;process.env.MODEL_TIMEOUT_MS='10';t.after(()=>{if(old===undefined)delete process.env.MODEL_TIMEOUT_MS;else process.env.MODEL_TIMEOUT_MS=old;});
 let release!:(r:{text:string;usage:Usage})=>void,disposed=0;
 const {engine}=fixture(t,()=>pair(async()=>new Promise(resolve=>{release=resolve;}),30).map(a=>({...a,dispose:async()=>{disposed++;}})));
 const s=engine.create('Idea',3,undefined,{budget:{maxTokens:60}});await engine.run(s);
 assert.equal(s.budget?.chargedTokens,60);assert.equal(s.budget?.unknownUsageCalls,2);assert.equal(disposed,2);const state=JSON.stringify(s.budget);
 release({text:'late',usage:{inputTokens:0,outputTokens:0}});await new Promise(resolve=>setImmediate(resolve));assert.equal(JSON.stringify(s.budget),state);assert.equal(s.entries.length,0);
});
test('provider ceiling breach records actual usage and refuses subsequent rounds',async t=>{
 const {engine}=fixture(t,()=>pair(async()=>({text:'answer',usage:{inputTokens:50,outputTokens:1,usd:null}}),20));
 const s=engine.create('Idea',3,undefined,{budget:{maxTokens:40}});await engine.run(s);
 assert.equal(s.calls,2);assert.equal(s.budget?.chargedTokens,102);assert.equal(s.budget?.breached,true);assert.equal(s.status,'failed');assert.match(s.report!,/TOKEN CEILING BREACH/);
});
test('concurrent sessions have independent immutable budgets',async t=>{
 const {engine}=fixture(t,()=>pair(async()=>({text:'answer',usage:{inputTokens:10,outputTokens:0,usd:null}}),20));
 const budget={maxCalls:4,maxTokens:80};const a=engine.create('A',3,undefined,{budget}),b=engine.create('B',3,undefined,{budget});budget.maxCalls=9;budget.maxTokens=999;
 assert.equal(a.budgetPolicy?.maxCalls,4);assert.throws(()=>{(a.budgetPolicy as any).maxCalls=9;});
 await Promise.all([engine.run(a),engine.run(b)]);for(const s of [a,b]){assert.equal(s.calls,4);assert.equal(s.budget?.chargedTokens,40);assert.equal(s.status,'partial');}
});
test('cancellation settles started reservations conservatively and performs cleanup',async t=>{
 let began!:()=>void;const started=new Promise<void>(resolve=>{began=resolve;});let disposed=0;
 const {engine}=fixture(t,()=>pair(async(_p,_r,signal)=>{began();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));},30).map(a=>({...a,dispose:async()=>{disposed++;}})));
 const s=engine.create('Idea',3,undefined,{budget:{maxTokens:60}});const running=engine.run(s);await started;engine.cancel(s);await running;
 assert.equal(s.status,'cancelled');assert.equal(s.budget?.chargedTokens,60);assert.equal(s.budget?.reservedTokens,0);assert.equal(disposed,2);
});

test('too-small strict budgets and single-call caps refuse before runtime preparation',async t=>{
 let prepares=0,calls=0;const {engine}=fixture(t,()=>pair(async()=>{calls++;return {text:'answer'};},30).map(a=>({...a,prepare:async()=>{prepares++;}})));
 for(const budget of [{maxTokens:59},{maxCalls:1}]){const s=engine.create('Idea',3,undefined,{budget});await engine.run(s);assert.equal(s.calls,0);assert.equal(s.status,'partial');assert.equal(s.budget?.admittedCalls,0);}
 assert.equal(prepares,0);assert.equal(calls,0);
});
test('cancellation after reservation but before dispatch does not spend tokens',async t=>{
 let calls=0;const {engine}=fixture(t,()=>pair(async()=>{calls++;return {text:'answer'};},30));
 const s=engine.create('Idea',3,undefined,{budget:{maxTokens:60}});engine.on(s.id,e=>{if(e.type==='budget.reserved')engine.cancel(s);});await engine.run(s);
 assert.equal(calls,0);assert.equal(s.calls,0);assert.equal(s.budget?.reservedTokens,0);assert.equal(s.budget?.chargedTokens,0);assert.equal(s.status,'cancelled');
});


for(const size of [2,3])test(`call-bounded ${size}-provider discussion completes all rounds without a token ceiling`,async t=>{
 let prepared=0,disposed=0;const seen:Array<{id:string;round:number;prompt:string}>=[];
 const {engine,dir}=fixture(t,()=>['codex','claude','grok'].slice(0,size).map(id=>({id:id as Adapter['id'],
  prepare:async()=>{prepared++;},dispose:async()=>{disposed++;},
  run:async(prompt,round)=>{seen.push({id,round,prompt});await Promise.resolve();return {text:`${id} round ${round}`,usage:{inputTokens:100000,outputTokens:20,cacheReadTokens:90000,reasoningTokens:10,usd:null}};}
 })));
 const s=engine.create('Synthetic idea',3,undefined,{budget:{maxCalls:size*3,maxTokens:null}});await engine.run(s);
 assert.equal(s.calls,size*3);assert.equal(s.entries.length,size*3);assert.equal(s.status,'completed');
 assert.equal(prepared,size);assert.equal(disposed,size);assert.equal(s.budget?.chargedTokens,size*3*100020);
 assert.equal(s.budget?.policy.maxTokens,null);assert.equal(s.budget?.unknownUsageCalls,0);assert.equal(s.budget?.breached,false);
 assert.equal(s.events.filter(e=>e.type==='round.completed').length,3);
 for(const call of seen.filter(c=>c.round===2))for(const peer of ['codex','claude','grok'].slice(0,size).filter(id=>id!==call.id))assert.ok(call.prompt.includes(`${peer} round 1`));
 assert.match(s.report!,/Mode: call-bounded discussion/);assert.match(s.report!,/no hard token ceiling is enforced/);
 assert.match(s.report!,/Unknown cost/);assert.match(s.report!,/hidden SDK retries or backend requests/);
 const saved=new SavedSessions(dir).load(s.id);assert.deepEqual(saved?.budget,s.budget);assert.equal(saved?.report,s.report);
});

test('call-bounded failure consumes a slot, retains partial tokens and prevents a partial next round',async t=>{
 let disposed=0;const {engine}=fixture(t,()=>['codex','claude','grok'].map(id=>({id:id as Adapter['id'],dispose:async()=>{disposed++;},
  run:async()=>{if(id==='grok')throw new ProviderFailure('synthetic','offline failure',{usage:{inputTokens:7,usd:null}});return {text:'answer',usage:{inputTokens:10,outputTokens:5,usd:null}};}
 })));
 const s=engine.create('Synthetic idea',3,undefined,{budget:{maxCalls:4}});await engine.run(s);
 assert.equal(s.calls,3);assert.equal(s.budget?.admittedCalls,3);assert.equal(s.budget?.chargedTokens,37);
 assert.equal(s.budget?.unknownUsageCalls,1);assert.equal(s.entries.length,2);assert.equal(disposed,3);
 assert.equal(s.status,'partial');assert.match(s.report!,/Selected provider failed/);
 assert.match(s.report!,/lower bound, not the discussion total/);assert.match(s.report!,/Unknown cost/);
});


for(const stop of ['timeout','cancel'] as const)test(`call-bounded ${stop} preserves unknown usage and cleans up`,async t=>{
 const old=process.env.MODEL_TIMEOUT_MS;process.env.MODEL_TIMEOUT_MS='20';t.after(()=>{if(old===undefined)delete process.env.MODEL_TIMEOUT_MS;else process.env.MODEL_TIMEOUT_MS=old;});
 let began!:()=>void;const started=new Promise<void>(resolve=>{began=resolve;});let disposed=0;
 const {engine}=fixture(t,()=>pair(async(_p,_r,signal)=>{began();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('offline abort')),{once:true}));}).map(a=>({...a,dispose:async()=>{disposed++;}})));
 const s=engine.create('Synthetic idea',3,undefined,{budget:{maxCalls:6}});const running=engine.run(s);
 await started;if(stop==='cancel')engine.cancel(s);await running;
 assert.equal(s.calls,2);assert.equal(s.budget?.unknownUsageCalls,2);assert.equal(s.budget?.chargedTokens,0);
 assert.equal(s.budget?.reservedTokens,0);assert.equal(disposed,2);assert.equal(s.spendIncomplete,true);
 assert.equal(s.status,stop==='cancel'?'cancelled':'partial');assert.match(s.report!,/Missing usage is unknown, not zero/);
 assert.match(s.report!,/remote work may continue/);assert.match(s.report!,/Unknown cost/);
});
