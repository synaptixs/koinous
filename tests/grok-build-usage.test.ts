import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import type {Session} from '../src/core.ts';
import {makeReport} from '../src/core.ts';
import {buildProtocol} from '../src/grok-build.ts';
import {grokBuildUsage} from '../src/grok-build-usage.ts';
import {ProviderFailure,usageSummary} from '../src/provider-runtime.ts';

// Synthetic fixture shaped from xAI's PromptUsage serialization tests; not live traffic.
const ledger={inputTokens:100,outputTokens:40,totalTokens:140,cachedReadTokens:60,cacheCreationTokens:20,reasoningTokens:10,modelCalls:2,numTurns:1,costUsdTicks:123000000,modelUsage:{model:{inputTokens:100,outputTokens:40}}};
const response=(usage:unknown)=>({_meta:{usage,inputTokens:999,outputTokens:888,totalTokens:99999}});
test('Build aggregate prompt ledger is authoritative; cache and model rows are not added',()=>{
 assert.deepEqual(grokBuildUsage(response(ledger)),{inputTokens:100,outputTokens:40,cacheReadTokens:60,cacheWriteTokens:20,reasoningTokens:10,usd:.0123,costSource:'provider-reported'});
});
test('Build absent, sibling last-call and context counters cannot become prompt billing',()=>{
 for(const value of [null,{},[],{usage:ledger},{_meta:{inputTokens:100,outputTokens:40,totalTokens:140}},{_meta:{usage:null}},{_meta:{usage:[]}}])assert.deepEqual(grokBuildUsage(value),{usd:null});
});
test('Build incomplete ledgers stay unknown, including plausible zero or partial totals',()=>{
 for(const flag of [true,'false',null,0])assert.deepEqual(grokBuildUsage(response({...ledger,usageIsIncomplete:flag})),{usd:null});
});
test('Build cost remains unknown for absent, partial, unsafe or zero ticks',()=>{
 for(const patch of [{costUsdTicks:undefined},{costUsdTicks:0},{costUsdTicks:-1},{costUsdTicks:1.5},{costUsdTicks:'100'},{costUsdTicks:Number.MAX_SAFE_INTEGER+1},{costIsPartial:true},{costIsPartial:'false'}]){
  const usage=grokBuildUsage(response({...ledger,...patch}));assert.equal(usage.inputTokens,100);assert.equal(usage.usd,null);assert.equal(usage.costSource,undefined);
 }
});
test('Build validates fields individually and preserves explicit zero token counts',()=>{
 assert.deepEqual(grokBuildUsage(response({inputTokens:0,outputTokens:0,cachedReadTokens:0,cacheCreationTokens:0,reasoningTokens:0})),{usd:null,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0});
 for(const invalid of [-1,1.2,'42',null,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])assert.deepEqual(grokBuildUsage(response({inputTokens:invalid,outputTokens:4})),{usd:null,outputTokens:4});
});
function wire(result:Record<string,unknown>,empty=false){
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){return true;}});
 const methods:string[]=[];
 const send=(m:unknown)=>child.stdout.write(JSON.stringify(m)+'\n');
 child.stdin.on('data',(b:Buffer)=>{
  const m=JSON.parse(b.toString());methods.push(m.method);
  queueMicrotask(()=>{
   if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,authMethods:[{id:'cached_token'}]}});
   else if(m.method==='authenticate')send({jsonrpc:'2.0',id:m.id,result:{}});
   else if(m.method==='session/new')send({jsonrpc:'2.0',id:m.id,result:{sessionId:'s'}});
   else {
    for(const sessionId of ['other','s','s'])send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'usage_update',used:999,size:2000,cost:{amount:50,currency:'USD'},_meta:{usage:ledger}}}});
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'HIDDEN SECRET'}}}});
    if(!empty)send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'4'}}}});
    send({jsonrpc:'2.0',id:m.id,result});
   }
  });
 });
 return {child:child as unknown as ChildProcessWithoutNullStreams,methods};
}
test('Build parses terminal usage once without extra RPCs or counting context updates',async()=>{
 const f=wire({stopReason:'end_turn',...response(ledger)});
 const r=await buildProtocol(f.child,'/workspace',new AbortController().signal,'What is two plus two?');
 assert.equal(r.text,'4');assert.deepEqual(r.usage,grokBuildUsage(response(ledger)));
 assert.deepEqual(f.methods,['initialize','authenticate','session/new','session/prompt']);
 assert.doesNotMatch(JSON.stringify(r),/HIDDEN|SECRET|99999/);
});
test('Build keeps complete recorded usage on truncated or empty answers',async()=>{
 for(const [reason,empty,code] of [['max_tokens',false,'incomplete_response'],['end_turn',true,'empty_response']] as const){
  const f=wire({stopReason:reason,...response(ledger)},empty);
  await assert.rejects(buildProtocol(f.child,'/workspace',new AbortController().signal,'q'),(error:unknown)=>{
   assert.ok(error instanceof ProviderFailure);assert.equal(error.code,code);assert.deepEqual(error.details.usage,grokBuildUsage(response(ledger)));return true;
  });
 }
});
test('Build missing terminal ledger never reuses another invocation or stream snapshot',async()=>{
 for(const result of [response(ledger),{},response({...ledger,usageIsIncomplete:true})]){
  const f=wire({stopReason:'end_turn',...result});const r=await buildProtocol(f.child,'/workspace',new AbortController().signal,'q');
  assert.deepEqual(r.usage,grokBuildUsage(result));
 }
});
test('reports reconcile successful and failed Build usage and keep missing costs explicit',()=>{
 const known=grokBuildUsage(response(ledger)),unknown=grokBuildUsage(response({...ledger,costUsdTicks:undefined}));
 const events=[{seq:1,at:'test',type:'agent.completed',agent:'grok',usage:known},{seq:2,at:'test',type:'agent.error',agent:'grok',round:2,usage:unknown}];
 const summary=usageSummary(events);assert.deepEqual(summary.inputTokens,{known:200,missingCalls:0});assert.deepEqual(summary.usd,{known:.0123,missingCalls:1});
 const session:Session={id:'usage-test',prompt:'q',maxRounds:2,status:'partial',calls:2,participants:['grok'],entries:[{round:1,agent:'grok',text:'4',usage:known}],events,interventions:[],spendKnownUSD:.0123,spendIncomplete:true,cancel:new AbortController()};
 const report=makeReport(session);assert.match(report,/\| inputTokens \| 200 \| 0 \|/);assert.match(report,/\| usd \| 0.0123 \| 1 \|/);assert.match(report,/Unknown cost.*1 call/);assert.match(report,/unknown costs are not zero/);
 const allMissing=makeReport({...session,spendKnownUSD:0,events:[{...events[0],usage:{usd:null}}]});assert.match(allMissing,/Unknown cost.*1 call/);
});
