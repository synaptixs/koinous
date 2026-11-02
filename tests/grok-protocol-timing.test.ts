import {PROXY_COUNTERS} from '../src/grok-diagnostics.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {GrokTiming} from '../src/grok-protocol-timing.ts';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {buildProtocol,launchBuild} from '../src/grok-build.ts';
import {Engine} from '../src/engine.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import type {Adapter} from '../src/core.ts';
const secret='PRIVATE-SENTINEL';
function transport(stall='',error=false){
 const methods:string[]=[];
 const c=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){queueMicrotask(()=>c.emit('close',0));return true;}});
 const send=(m:unknown)=>c.stdout.write(JSON.stringify(m)+'\n');
 c.stdin.on('data',(b:Buffer)=>{const m=JSON.parse(b.toString());if(!m.method)return;methods.push(m.method);
 if(m.method==='session/prompt'){
  c.stderr.write('KOINOUS_GROK_PROXY_V1 '+JSON.stringify(Object.fromEntries(PROXY_COUNTERS.map(k=>[k,k==='attemptLimit'?1:0])))+'\n');
  send({jsonrpc:'2.0',method:'x.ai/session_notification',params:{sessionId:secret,payload:secret}});
  send({jsonrpc:'2.0',method:'x.ai/session_notification',params:{sessionId:'other',payload:secret}});
 }
 if(m.method===stall)return;
 queueMicrotask(()=>{c.stderr.write(secret+'\n');if(error){send({jsonrpc:'2.0',id:m.id,error:{message:secret}});return;}
 let result:unknown={};if(m.method==='initialize')result={protocolVersion:1,authMethods:[{id:'grok.com'}]};if(m.method==='session/new')result={sessionId:secret};
 if(m.method==='session/prompt'){
  for(let i=0;i<50;i++)send({jsonrpc:'2.0',method:'session/update',params:{sessionId:secret,update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:secret}}}});
  send({jsonrpc:'2.0',method:'session/update',params:{sessionId:secret,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Exact public answer.\n'}}}});result={stopReason:'end_turn'};
 }
 send({jsonrpc:'2.0',id:m.id,result});});
 });c.stdin.on('finish',()=>queueMicrotask(()=>c.emit('close',0)));return {child:c as unknown as ChildProcessWithoutNullStreams,methods};
}
test('bounded monotonic snapshots have exact stage durations and cannot be mutated',()=>{
 let time=100;const trace=new GrokTiming(()=>time);time=110;trace.advance('authentication');time=130;trace.advance('session-creation');time=140;trace.advance('inference');time=170;trace.complete();
 const a=trace.snapshot();assert.deepEqual(a.stages.map(s=>s.durationMs),[10,20,10,30]);assert.equal(a.elapsedMs,70);assert.ok(a.stages.every(s=>s.completed));
 assert.throws(()=>{(a.stages[0] as {durationMs:number}).durationMs=99;});time=200;assert.equal(a.elapsedMs,70);
 for(let i=0;i<100;i++)trace.advance('startup');assert.equal(trace.snapshot().stages.length,4);
 time=-100;assert.ok(trace.snapshot().elapsedMs>=70);time=Infinity;assert.ok(Number.isFinite(trace.snapshot().elapsedMs));time=1e15;assert.equal(trace.snapshot().elapsedMs,2147483647);
});
for(const authOnly of [true,false])test(`successful ${authOnly?'authentication':'inference'} returns content-free bounded timings`,async()=>{
 const f=transport();const reply=await buildProtocol(f.child,'/'+secret,new AbortController().signal,authOnly?undefined:secret,true,'grok.com');
 assert.equal(reply.protocolTiming?.stages.length,authOnly?2:4);assert.ok(reply.protocolTiming?.stages.every(s=>s.completed));assert.doesNotMatch(JSON.stringify(reply.protocolTiming),/PRIVATE-SENTINEL|Exact public answer|sessionId|prompt|token|stderr/);assert.ok(JSON.stringify(reply.protocolTiming).length<800);
 if(!authOnly){assert.equal(reply.text,'Exact public answer.\n');assert.deepEqual(reply.grokDiagnostics?.progress,{messageChunks:1,thoughtChunks:50,sessionNotifications:1});assert.equal(reply.grokDiagnostics?.proxy?.attemptLimit,1);assert.doesNotMatch(JSON.stringify(reply.grokDiagnostics),/PRIVATE-SENTINEL|Exact public/);}else assert.deepEqual(f.methods,['initialize','authenticate']);
});
test('provider protocol errors carry stage timing without retaining error payloads',async()=>{
 const f=transport('',true);await assert.rejects(buildProtocol(f.child,'/'+secret,new AbortController().signal,secret,true,'grok.com'),(e:unknown)=>{const error=e as import('../src/provider-runtime.ts').ProviderFailure;assert.equal(error.details.protocolTiming?.lastStage,'startup');assert.doesNotMatch(JSON.stringify(error.details),/PRIVATE-SENTINEL/);return true;});
});
for(const stalled of ['initialize','authenticate','session/new','session/prompt'])test(`managed launch outer timeout persists ${stalled} timing before cleanup and survives saved reload`,async t=>{
 const dir=mkdtempSync(join(tmpdir(),'grok-timing-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));writeFileSync(join(dir,'auth.json'),JSON.stringify({token:secret}));
 const old=process.env.GROK_TIMEOUT_MS;process.env.GROK_TIMEOUT_MS='30';t.after(()=>{if(old===undefined)delete process.env.GROK_TIMEOUT_MS;else process.env.GROK_TIMEOUT_MS=old;});
 const f=transport(stalled);let launches=0;
 const engine=new Engine(()=>['codex','claude','grok'].map(id=>({id:id as Adapter['id'],async run(_p,_r,signal){if(id!=='grok')return {text:'unchanged',usage:{usd:null}};
 return launchBuild(signal,secret,()=>{launches++;return f.child;},'synthetic-model',{podman:'/fixture/podman',vm:'koinous-grok-synthetic',authHome:dir});
 }})),dir);
 const s=engine.create('Synthetic',3);await engine.run(s);assert.equal(s.status,'partial');assert.equal(s.calls,3);assert.equal(launches,1);
 const e=s.events.find(e=>e.type==='agent.error'&&e.agent==='grok')!;assert.equal(e.code,'timeout');
 if(stalled==='session/prompt'){const d=e.grokDiagnostics as import('../src/grok-diagnostics.ts').GrokDiagnostics;assert.equal(d.proxy?.attemptLimit,1);assert.equal(d.progress.sessionNotifications,1);assert.doesNotMatch(JSON.stringify(d),/PRIVATE-SENTINEL/);}
 const trace=e.protocolTiming as import('../src/grok-protocol-timing.ts').GrokProtocolTiming;
 assert.equal(trace.lastStage,({initialize:'startup',authenticate:'authentication','session/new':'session-creation','session/prompt':'inference'} as const)[stalled as 'initialize']);assert.equal(trace.stages.at(-1)?.completed,false);
 assert.doesNotMatch(JSON.stringify(trace),/PRIVATE-SENTINEL/);assert.equal(f.child.stdin.writableEnded,true);
 const bytes=readFileSync(join(dir,s.id,'events.jsonl'),'utf8');const saved=new SavedSessions(dir).load(s.id)!;assert.deepEqual(saved.events.find(e=>e.type==='agent.error'&&e.agent==='grok')?.protocolTiming,trace);assert.deepEqual(saved.events.find(e=>e.type==='agent.error'&&e.agent==='grok')?.grokDiagnostics,e.grokDiagnostics);
 await new Promise(r=>setImmediate(r));assert.equal(readFileSync(join(dir,s.id,'events.jsonl'),'utf8'),bytes);
});
test('user cancellation keeps its classification and timing snapshot ignores late protocol output',async()=>{
 const f=transport('session/prompt'),c=new AbortController();const result=buildProtocol(f.child,'/synthetic',c.signal,secret,true,'grok.com');
 await new Promise(r=>setImmediate(r));c.abort();let trace:unknown;
 await assert.rejects(result,(error:unknown)=>{const e=error as import('../src/provider-runtime.ts').ProviderFailure;assert.equal(e.code,'cancelled');assert.equal(e.details.protocolTiming?.lastStage,'inference');trace=e.details.protocolTiming;return true;});
 const before=JSON.stringify(trace);(f.child.stdout as PassThrough).write(JSON.stringify({jsonrpc:'2.0',id:4,result:{stopReason:'end_turn'}})+'\n');await new Promise(r=>setImmediate(r));assert.equal(JSON.stringify(trace),before);
});
