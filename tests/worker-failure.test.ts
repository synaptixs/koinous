import test from 'node:test';import assert from 'node:assert/strict';
import {ProviderFailure} from '../src/provider-runtime.ts';import {workerFailure} from '../src/worker-failure.ts';
test('worker failures retain valid usage without exposing error text, paths or identifiers',()=>{
 const e=new ProviderFailure('provider_error','PRIVATE_MESSAGE',{responseId:'PRIVATE_ID',sessionId:'/private/path',usage:{inputTokens:40,outputTokens:9,cacheReadTokens:5,usd:0.125,costSource:'provider-estimate'}});
 assert.deepEqual(workerFailure(e),{ok:false,error:'sdk_worker_failed',code:'provider_error',usage:{usd:0.125,costSource:'provider-estimate',inputTokens:40,outputTokens:9,cacheReadTokens:5}});
 assert.ok(!JSON.stringify(workerFailure(e)).includes('PRIVATE'));
});
test('malformed and missing failed-call usage stays unknown without invented cost',()=>{
 const e=new ProviderFailure('unknown_private_code','private',{usage:{inputTokens:-1,outputTokens:NaN,reasoningTokens:1.5,usd:Infinity}});
 assert.deepEqual(workerFailure(e),{ok:false,error:'sdk_worker_failed',code:'provider_error',usage:{usd:null}});
 assert.deepEqual(workerFailure(Error('raw CLI stderr')).usage,{usd:null});
 assert.equal(workerFailure(new ProviderFailure('timeout','private')).code,'timeout');
});
