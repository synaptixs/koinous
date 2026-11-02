import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {withDeadline, callTimeoutMs, usageSummary, ProviderFailure} from '../src/provider-runtime.ts';

function env(t: test.TestContext, key: string, value?: string) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
}

test('deadline bounds a non-cooperative provider and aborts its signal', async () => {
  const parent = new AbortController();
  let child: AbortSignal | undefined;
  const result = withDeadline(async signal => { child = signal; return new Promise<never>(() => {}); }, parent.signal, 10);
  await assert.rejects(result, e => e instanceof ProviderFailure && e.code === 'timeout');
  assert.equal(child?.aborted, true);
  assert.equal(parent.signal.aborted, false);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('cancellation is distinct from timeout and cleans up listeners', async () => {
  const parent = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>(resolve => {ready = resolve;});
  const result = withDeadline(async () => { ready(); return new Promise<never>(() => {}); }, parent.signal, 10000);
  await started;
  parent.abort();
  await assert.rejects(result, e => e instanceof ProviderFailure && e.code === 'cancelled');
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('success and provider rejection both clean up parent listeners', async () => {
  const parent = new AbortController();
  assert.equal(await withDeadline(async () => 'ok', parent.signal, 10000), 'ok');
  await assert.rejects(withDeadline(async () => {throw new Error('fail');}, parent.signal, 10000), /fail/);
  assert.equal(getEventListeners(parent.signal, 'abort').length, 0);
});

test('timeout configuration validates limits and provider overrides', t => {
  env(t, 'MODEL_TIMEOUT_MS', '120000');
  env(t, 'GROK_TIMEOUT_MS', '500');
  env(t, 'CODEX_TIMEOUT_MS');
  assert.equal(callTimeoutMs('grok'), 500);
  assert.equal(callTimeoutMs('codex'), 120000);
  for (const bad of ['0', '-1', 'NaN', 'Infinity', '1.5', '2147483648', '']) {
    process.env.GROK_TIMEOUT_MS = bad;
    assert.throws(() => callTimeoutMs('grok'));
  }
});

test('accounting includes error usage and exposes missing metrics without double counting', () => {
  const summary = usageSummary([
    {type: 'agent.completed', usage: {inputTokens: 100, outputTokens: 30, cacheReadTokens: 60, reasoningTokens: 20, usd: 0.1}},
    {type: 'agent.error', usage: {inputTokens: 10, outputTokens: 5, usd: 0.02}},
    {type: 'agent.error'},
    {type: 'session.finished', usage: {inputTokens: 999}}
  ]);
  assert.deepEqual(summary.inputTokens, {known: 110, missingCalls: 1});
  assert.deepEqual(summary.outputTokens, {known: 35, missingCalls: 1});
  assert.deepEqual(summary.cacheReadTokens, {known: 60, missingCalls: 2});
  assert.equal(summary.usd.missingCalls, 1);
  assert.ok(Math.abs(summary.usd.known - 0.12) < 1e-10);
});
