import test from 'node:test';
import assert from 'node:assert/strict';
import type {ModelUsage, SDKMessage, Options} from '@anthropic-ai/claude-agent-sdk';
import {CodexAdapter, ClaudeAdapter, GrokAdapter} from '../src/adapters.ts';
import {ProviderFailure} from '../src/provider-runtime.ts';

const signal = () => new AbortController().signal;
const modelUsage: ModelUsage = {inputTokens: 10, outputTokens: 7, cacheReadInputTokens: 20, cacheCreationInputTokens: 5, thinkingTokens: 3,
  webSearchRequests: 0, costUSD: 0.02, contextWindow: 200000, maxOutputTokens: 1000};
function claudeResult(overrides: Record<string, unknown> = {}): SDKMessage {
  // Fixtures intentionally omit unrelated telemetry fields; production types are checked separately.
  return {type: 'result', subtype: 'success', is_error: false, result: 'Answer', total_cost_usd: 0.02,
    modelUsage: {'claude-test': modelUsage}, session_id: 'session-1', uuid: 'response-1', ...overrides} as unknown as SDKMessage;
}
function claude(messages: SDKMessage[], inspect: (options: Options) => void = () => {}) {
  let closes = 0;
  const adapter = new ClaudeAdapter(async () => ({options}) => {
    inspect(options);
    return {async *[Symbol.asyncIterator]() { yield* messages; }, close() { closes++; }};
  });
  return {adapter, closes: () => closes};
}

test('Codex forwards cancellation and preserves token breakdowns without guessing cost', async () => {
  const abort = signal();
  let starts = 0;
  const adapter = new CodexAdapter(async () => ({startThread(options) {
    starts++;
    assert.equal(options.sandboxMode, 'read-only');
    assert.equal(options.approvalPolicy, 'never');
    assert.equal(options.networkAccessEnabled, false);
    return {id: 'thread-1', async run(_prompt, options) {
      assert.equal(options?.signal, abort);
      return {items: [], finalResponse: 'Answer', usage: {input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 10, output_tokens: 25, reasoning_output_tokens: 15}};
    }};
  }}));
  const reply = await adapter.run('Q', 1, abort);
  await adapter.run('Q2', 2, abort);
  assert.equal(starts, 1);
  assert.deepEqual(reply.usage, {inputTokens: 100, outputTokens: 25, cacheReadTokens: 40, cacheWriteTokens: 10, reasoningTokens: 15, usd: null});
  assert.equal(reply.sessionId, 'thread-1');
});

test('Codex empty answers preserve available usage on the error', async () => {
  const adapter = new CodexAdapter(async () => ({startThread: () => ({id: null, async run() {return {items: [], finalResponse: '', usage: null};}})}));
  await assert.rejects(adapter.run('Q', 1, signal()), e => e instanceof ProviderFailure && e.code === 'empty_response' && e.details.usage?.usd === null);
});

test('Claude counts query totals including cache once and closes the query', async () => {
  const {adapter, closes} = claude([claudeResult()], options => {
    assert.deepEqual(options.tools, []);
    assert.deepEqual(options.settingSources, []);
    assert.equal(options.maxTurns, 1);
  });
  const result = await adapter.run('Q', 1, signal());
  assert.equal(result.usage?.inputTokens, 35);
  assert.equal(result.usage?.outputTokens, 7);
  assert.equal(result.usage?.cacheReadTokens, 20);
  assert.equal(result.usage?.reasoningTokens, 3);
  assert.equal(result.usage?.usd, 0.02);
  assert.equal(result.model, 'claude-test');
  assert.equal(closes(), 1);
});

for (const overrides of [{subtype: 'error_max_budget_usd'}, {is_error: true}, {result: ''}]) {
  test(`Claude preserves billed usage on unsuccessful result ${JSON.stringify(overrides)}`, async () => {
    const {adapter, closes} = claude([claudeResult(overrides)]);
    await assert.rejects(adapter.run('Q', 1, signal()), e => e instanceof ProviderFailure && e.details.usage?.usd === 0.02 && e.details.usage?.inputTokens === 35);
    assert.equal(closes(), 1);
  });
}

test('Claude missing usage remains unknown', async () => {
  const {adapter} = claude([claudeResult({modelUsage: {}, total_cost_usd: undefined})]);
  const result = await adapter.run('Q', 1, signal());
  assert.equal(result.usage?.inputTokens, undefined);
  assert.equal(result.usage?.usd, null);
});

test('Claude abort reaches the SDK controller and closes a stalled stream', async () => {
  const parent = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>(r => { ready = r; });
  let closed = false;
  const adapter = new ClaudeAdapter(async () => ({options}) => ({
    async *[Symbol.asyncIterator]() {
      const stopped = new Promise<never>((_, reject) => options.abortController!.signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true}));
      ready();
      await stopped;
    }, close() { closed = true; }
  }));
  const pending = adapter.run('Q', 1, parent.signal);
  await started;
  parent.abort();
  await assert.rejects(pending);
  assert.equal(closed, true);
});

function xaiKey(t: test.TestContext) {
  const old = process.env.XAI_API_KEY;
  process.env.XAI_API_KEY = 'synthetic-test-key';
  t.after(() => { if (old === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = old; });
}
const grokBody = {id: 'response-x', model: 'grok-test', status: 'completed', output: [
  {type: 'reasoning', content: [{type: 'output_text', text: 'PRIVATE REASONING'}]},
  {type: 'message', content: [{type: 'output_text', text: 'Answer'}]}],
  usage: {input_tokens: 100, output_tokens: 30, input_tokens_details: {cached_tokens: 40}, output_tokens_details: {reasoning_tokens: 12}, cost_in_usd_ticks: 37756000}};

test('Grok sends a bounded text-only request and normalizes Responses accounting', async t => {
  xaiKey(t);
  const abort = signal();
  const adapter = new GrokAdapter(async (url, init) => {
    assert.equal(url, 'https://api.x.ai/v1/responses');
    assert.equal(init?.signal, abort);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    assert.ok(body.max_output_tokens > 0);
    return Response.json(grokBody);
  });
  const reply = await adapter.run('Q', 1, abort);
  assert.equal(reply.text, 'Answer');
  assert.equal(reply.responseId, 'response-x');
  assert.equal(reply.usage?.inputTokens, 100);
  assert.equal(reply.usage?.outputTokens, 30);
  assert.equal(reply.usage?.cacheReadTokens, 40);
  assert.equal(reply.usage?.reasoningTokens, 12);
  assert.equal(reply.usage?.usd, 0.0037756);
});

for (const status of ['incomplete', 'failed', 'in_progress']) {
  test(`Grok ${status} result is not accepted as a successful answer`, async t => {
    xaiKey(t);
    const adapter = new GrokAdapter(async () => Response.json({...grokBody, status}));
    await assert.rejects(adapter.run('Q', 1, signal()), e => e instanceof ProviderFailure && e.details.usage?.outputTokens === 30);
  });
}

test('Grok HTTP errors omit response bodies and do not retry', async t => {
  xaiKey(t);
  let requests = 0;
  const adapter = new GrokAdapter(async () => {requests++; return new Response('SECRET echoed prompt', {status: 429});});
  await assert.rejects(adapter.run('Q', 1, signal()), e => e instanceof ProviderFailure && e.message === 'Grok API HTTP 429');
  assert.equal(requests, 1);
});

test('Grok absent or invalid usage is unknown, not zero', async t => {
  xaiKey(t);
  const adapter = new GrokAdapter(async () => Response.json({...grokBody, usage: {input_tokens: -1, output_tokens: '30'}}));
  const result = await adapter.run('Q', 1, signal());
  assert.equal(result.usage?.inputTokens, undefined);
  assert.equal(result.usage?.outputTokens, undefined);
  assert.equal(result.usage?.usd, null);
});

test('already-cancelled calls never initialize providers', async () => {
  const signal = AbortSignal.abort();
  const noCall = async (): Promise<never> => { throw new Error('must not initialize'); };
  for (const adapter of [new CodexAdapter(noCall), new ClaudeAdapter(noCall), new GrokAdapter(noCall)]) {
    await assert.rejects(adapter.run('Q', 1, signal), e => e instanceof DOMException && e.name === 'AbortError');
  }
});

test('concurrent Codex adapters retain explicit models and subscription settings', async () => {
 const make=(model:string)=>new CodexAdapter(async config=>{
  assert.equal(config.config?.forced_login_method,'chatgpt');assert.equal(config.apiKey,undefined);
  return {startThread(options){assert.equal(options.model,model);return {id:model,async run(){await Promise.resolve();return {items:[],finalResponse:model,usage:null};}};}};
 },model);
 const replies=await Promise.all(['model-a','model-b'].map(model=>make(model).run('Synthetic',1,signal())));
 assert.deepEqual(replies.map(r=>r.requestedModel),['model-a','model-b']);
});
test('concurrent Claude adapters retain explicit models and subscription settings', async () => {
 const make=(model:string)=>new ClaudeAdapter(async()=>({options})=>{
  assert.equal(options.model,model);assert.deepEqual(options.settings,{forceLoginMethod:'claudeai'});assert.equal(options.env?.ANTHROPIC_API_KEY,undefined);
  return {async *[Symbol.asyncIterator](){yield claudeResult();},close(){}};
 },model);
 const replies=await Promise.all(['model-a','model-b'].map(model=>make(model).run('Synthetic',1,signal())));
 assert.deepEqual(replies.map(r=>r.requestedModel),['model-a','model-b']);
});
