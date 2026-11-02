import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSmokeAnswer, runGrokSmoke, SMOKE_PROMPT} from '../src/grok-smoke.ts';
import {GrokAdapter} from '../src/adapters.ts';
import {ProviderFailure} from '../src/provider-runtime.ts';

function config(t: test.TestContext) {
  for (const [key, value] of Object.entries({XAI_API_KEY:'synthetic-test-key', GROK_REASONING_EFFORT:'low', GROK_MAX_OUTPUT_TOKENS:'128', GROK_MODEL:'grok-4.7'})) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
const body = {status:'completed', model:'grok-4.7', id:'synthetic-response', reasoning:{effort:'low'},
  output:[{type:'message',content:[{type:'output_text',text:'Two plus two is four.'}]}],
  usage:{input_tokens:10,output_tokens:203,output_tokens_details:{reasoning_tokens:198},cost_in_usd_ticks:1000000}};

test('answer check accepts common correct forms and rejects refusal/ambiguity', () => {
  for (const text of ['4', 'Four.', '**4**', '2 + 2 = 4.', 'Two plus two is four.', 'The answer is 4.']) assert.equal(checkSmokeAnswer(text), true, text);
  for (const text of ['42', 'Not 4.', 'I will not answer 4.', '4 or 5', '', '5', '4. Actually, five.']) assert.equal(checkSmokeAnswer(text), false, text);
});

test('smoke sends low reasoning and one bounded request with independent checks', async t => {
  config(t);
  let requests = 0;
  const result = await runGrokSmoke(async (url, init) => {
    requests++;
    assert.equal(url, 'https://api.x.ai/v1/responses');
    const sent = JSON.parse(String(init?.body));
    assert.deepEqual(sent.reasoning, {effort:'low'});
    assert.equal(sent.max_output_tokens, 128);
    assert.equal(sent.store, false);
    assert.equal(sent.tools, undefined);
    assert.equal(sent.previous_response_id, undefined);
    assert.deepEqual(sent.input, [{role:'user',content:SMOKE_PROMPT}]);
    return Response.json(body);
  });
  assert.equal(requests, 1);
  assert.deepEqual(result.checks, {connectivity:'passed',httpSuccess:'passed',completion:'passed',answer:'passed'});
  assert.equal(result.observedNonReasoningOutputTokens, 5);
  assert.equal(result.observedTotalTokens, 213);
  assert.equal(result.echoedEffort, 'low');
  assert.equal(JSON.stringify(result).includes('synthetic-test-key'), false);
});

test('refusal is an answer failure, not a connection failure', async t => {
  config(t);
  const result = await runGrokSmoke(async () => Response.json({...body,output:[{type:'message',content:[{type:'output_text',text:'I cannot answer.'}]}]}));
  assert.deepEqual(result.checks, {connectivity:'passed',httpSuccess:'passed',completion:'passed',answer:'failed'});
});

test('HTTP authentication failure is reachable but not successful, with no retry', async t => {
  config(t);
  let requests = 0;
  const result = await runGrokSmoke(async () => {requests++;return new Response('SECRET', {status:401});});
  assert.equal(requests, 1);
  assert.deepEqual(result.checks, {connectivity:'passed',httpSuccess:'failed',completion:'failed',answer:'not_checked'});
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
});

test('incomplete response preserves cost and does not grade partial text', async t => {
  config(t);
  const result = await runGrokSmoke(async () => Response.json({...body,status:'incomplete'}));
  assert.equal(result.checks.completion, 'failed');
  assert.equal(result.checks.answer, 'not_checked');
  assert.equal(result.usage?.usd, 0.0001);
});

test('stalled transport is bounded without retrying', async t => {
  config(t);
  let requests = 0;
  const result = await runGrokSmoke(async () => {requests++;return new Promise<Response>(() => {});}, 10);
  assert.equal(result.error?.code, 'timeout');
  assert.equal(result.checks.connectivity, 'failed');
  assert.equal(result.checks.answer, 'not_checked');
  assert.equal(requests, 1);
});

test('wrong smoke configuration prevents a network request', async t => {
  config(t);
  process.env.GROK_REASONING_EFFORT = 'high';
  let requests = 0;
  const result = await runGrokSmoke(async () => {requests++;return Response.json(body);});
  assert.equal(requests, 0);
  assert.equal(result.error?.code, 'configuration');
});

test('invalid reasoning effort fails before dispatch', async t => {
  config(t);
  process.env.GROK_REASONING_EFFORT = 'none';
  let requests = 0;
  const adapter = new GrokAdapter(async () => {requests++;return Response.json(body);});
  await assert.rejects(adapter.run('Q', 1, new AbortController().signal), e => e instanceof ProviderFailure && e.code === 'configuration');
  assert.equal(requests, 0);
});
