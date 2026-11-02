import type {Usage as CodexUsage} from '@openai/codex-sdk';
import type {Usage} from './core.ts';
import {tokenCount} from './provider-runtime.ts';

// @openai/codex-sdk 0.166.0 exposes these five counters, no cost field.
// Subscription charges cannot be derived from API list prices or token counts.
export function codexUsage(usage: CodexUsage | null): Usage {
  return {
    inputTokens: tokenCount(usage?.input_tokens), outputTokens: tokenCount(usage?.output_tokens),
    cacheReadTokens: tokenCount(usage?.cached_input_tokens), cacheWriteTokens: tokenCount(usage?.cache_write_input_tokens),
    reasoningTokens: tokenCount(usage?.reasoning_output_tokens), usd: null,
  };
}
