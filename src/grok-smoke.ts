import {GrokAdapter} from './adapters.ts';
import {ProviderFailure, withDeadline} from './provider-runtime.ts';
import type {Reply} from './core.ts';

export const SMOKE_PROMPT = 'What is two plus two? Please answer briefly.';

// A deliberately small accepted grammar; ambiguous or verbose answers need review.
export function checkSmokeAnswer(text: string): boolean {
  const answer = text.trim().toLowerCase().replace(/[*`]/g, '');
  return /^(?:(?:the answer is\s+)|(?:(?:2\s*\+\s*2|two plus two)\s*(?:=|is|equals)\s*))?(?:4|four)[.!]?$/.test(answer);
}

export async function runGrokSmoke(request: typeof fetch = fetch, timeoutMs = 45_000) {
  let requests = 0;
  let httpStatus: number | undefined;
  let responseStatus: string | undefined;
  let echoedEffort: string | undefined;
  let reply: Reply | undefined;
  let error: {code: string; message: string} | undefined;
  const started = performance.now();
  const adapter = new GrokAdapter(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (requests !== 0 || body.reasoning?.effort !== 'low' || body.max_output_tokens !== 128 || body.store !== false) {
      throw new ProviderFailure('configuration', 'Smoke test requires one request, low reasoning, 128 visible tokens, and store:false');
    }
    requests++;
    const response = await request(url, init);
    httpStatus = response.status;
    if (response.ok) {
      // Inspect only allowlisted metadata, never save headers, credentials, or reasoning content.
      const payload = await response.clone().json();
      if (['completed', 'incomplete', 'failed', 'in_progress'].includes(payload?.status)) responseStatus = payload.status;
      if (['low', 'medium', 'high', 'xhigh'].includes(payload?.reasoning?.effort)) echoedEffort = payload.reasoning.effort;
    }
    return response;
  });
  try {
    reply = await withDeadline(signal => adapter.run(SMOKE_PROMPT, 1, signal), new AbortController().signal, timeoutMs);
  } catch (caught) {
    error = caught instanceof ProviderFailure ? {code: caught.code, message: caught.message} : {code: 'transport_error', message: 'Provider call failed; raw diagnostic suppressed'};
    if (caught instanceof ProviderFailure) reply = {text: '', ...caught.details};
  }
  const completed = responseStatus === 'completed' && !error;
  const input = reply?.usage?.inputTokens;
  const total = reply?.usage?.outputTokens;
  const reasoning = reply?.usage?.reasoningTokens;
  return {
    at: new Date().toISOString(), provider: 'grok', prompt: SMOKE_PROMPT,
    requestedModel: process.env.GROK_MODEL || 'grok-4.7',
    bounds: {maxRequests: 1, requests, retries: 0, timeoutMs, reasoningEffort: 'low', maxVisibleOutputTokens: 128, hardTotalTokenOrUSDCap: false},
    checks: {
      connectivity: httpStatus === undefined ? 'failed' : 'passed',
      httpSuccess: httpStatus !== undefined && httpStatus >= 200 && httpStatus < 300 ? 'passed' : 'failed',
      completion: completed ? 'passed' : 'failed',
      answer: completed && reply ? (checkSmokeAnswer(reply.text) ? 'passed' : 'failed') : 'not_checked',
    },
    httpStatus, responseStatus, echoedEffort, durationMs: Math.round(performance.now() - started),
    ...(reply ?? {}), error,
    observedTotalTokens: input !== undefined && total !== undefined ? input + total : undefined,
    observedNonReasoningOutputTokens: total !== undefined && reasoning !== undefined && total >= reasoning ? total - reasoning : undefined,
  };
}
