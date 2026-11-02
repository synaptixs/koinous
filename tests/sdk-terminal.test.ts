import test from 'node:test';import assert from 'node:assert/strict';
import {terminalCodexThread,terminalClaudeStream} from '../src/sdk-terminal.ts';
import {ProviderFailure} from '../src/provider-runtime.ts';
async function collect(stream:AsyncIterable<unknown>){const rows=[];for await(const row of stream)rows.push(row);return rows;}
const text={type:'item.completed',item:{id:'a',type:'agent_message',text:'PRIVATE_PARTIAL'}};
const done={type:'turn.completed',usage:{input_tokens:20,output_tokens:5}};
const result={type:'result',subtype:'success',is_error:false,result:'final',modelUsage:{m:{inputTokens:20,outputTokens:5,cacheReadInputTokens:0,cacheCreationInputTokens:0}},total_cost_usd:0.01};
async function* events(rows:unknown[],failure=false){yield* rows as any[];if(failure)throw Error('PRIVATE_DIAGNOSTIC');}
for(const provider of ['codex','claude'] as const){
 const terminal=provider==='codex'?done:result,partial=provider==='codex'?text:{type:'assistant',message:{content:[{type:'text',text:'PRIVATE_PARTIAL'}]}};
 const run=async(rows:unknown[],failure=false,signal?:AbortSignal)=>{
  if(provider==='codex')return terminalCodexThread({id:'s',runStreamed:async()=>({events:events(rows,failure)})}).run('synthetic',{signal});
  return collect(terminalClaudeStream({[Symbol.asyncIterator]:()=>events(rows,failure),close(){}},signal));
 };
 for(const [name,rows,code] of [
  ['empty stream',[],'incomplete_response'],['partial EOF',[partial],'incomplete_response'],
  ['duplicate terminal',[partial,terminal,terminal],'invalid_response'],
  ['post-terminal text',[terminal,partial],'invalid_response'],
  ['malformed event',[null],'invalid_response'],
 ] as const)test(`${provider} terminal validator: ${name}`,async()=>{
  await assert.rejects(run([...rows]),e=>e instanceof ProviderFailure&&e.code===code&&!e.message.includes('PRIVATE'));
 });
 test(`${provider} terminal validator: trailing transport error preserves terminal counters`,async()=>{
  await assert.rejects(run([partial,terminal],true),e=>e instanceof ProviderFailure&&e.code==='provider_error'&&e.details.usage?.outputTokens===5&&e.details.usage.usd===(provider==='codex'?null:0.01)&&!e.message.includes('PRIVATE'));
 });
 test(`${provider} terminal validator: abort cannot publish completed text`,async()=>{
  const c=new AbortController();c.abort();await assert.rejects(run([terminal],false,c.signal),e=>e instanceof ProviderFailure&&e.code==='cancelled');
 });
 test(`${provider} terminal validator: exactly one terminal result succeeds`,async()=>{assert.ok(await run([partial,terminal]));});
}
test('Claude terminal validator rejects malformed success and retains available usage',async()=>{
 const stream=terminalClaudeStream({[Symbol.asyncIterator]:()=>events([{...result,result:42}]),close(){}});
 await assert.rejects(collect(stream),e=>e instanceof ProviderFailure&&e.code==='invalid_response'&&e.details.usage?.outputTokens===5);
});
test('Codex fatal event after partial text cannot become success',async()=>{
 const thread=terminalCodexThread({id:'s',runStreamed:async()=>({events:events([text,{type:'error',message:'PRIVATE_DIAGNOSTIC'},done])})});
 await assert.rejects(thread.run('synthetic'),e=>e instanceof ProviderFailure&&e.code==='provider_error'&&e.details.usage?.usd===null);
});
