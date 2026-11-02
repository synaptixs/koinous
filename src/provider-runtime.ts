import type {AgentId, Reply, Usage} from './core.ts';

export class ProviderFailure extends Error {
  code: string;
  details: Omit<Reply, 'text'>;
  constructor(code: string, message: string, details: Omit<Reply, 'text'> = {}) {
    super(message);
    this.name = 'ProviderFailure';
    this.code = code;
    this.details = details;
  }
}

export function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
export function cost(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export function sumKnown(values: Array<number | undefined>): number | undefined {
  return values.length > 0 && values.every(v => v !== undefined) ? values.reduce<number>((a, b) => a + b!, 0) : undefined;
}
export function positiveNumber(name: string, fallback: number, integer = true): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isSafeInteger(value))) {
    throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}`);
  }
  return value;
}
export function callTimeoutMs(agent: AgentId): number {
  const value = positiveNumber(`${agent.toUpperCase()}_TIMEOUT_MS`, positiveNumber('MODEL_TIMEOUT_MS', 120_000));
  if (value > 2_147_483_647) throw new Error('Model timeout exceeds timer range');
  return value;
}

// Bound waiting even if an SDK ignores abort. The remote request may still incur cost.
export async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  if (parent.aborted) throw new ProviderFailure('cancelled', 'Cancelled');
  const controller = new AbortController();
  let rejectAbort: (error: Error) => void = () => {};
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const stop = (code: string, message: string) => {
    const error = new ProviderFailure(code, message);
    rejectAbort(error);
    controller.abort(error);
  };
  const onAbort = () => stop('cancelled', 'Cancelled');
  parent.addEventListener('abort', onAbort, {once: true});
  const timer = setTimeout(() => stop('timeout', `Provider exceeded ${timeoutMs} ms deadline`), timeoutMs);
  try {
    return await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return run(controller.signal);
    }), aborted]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', onAbort);
  }
}

export function usageSummary(events: Array<{type: string; [key: string]: unknown}>) {
  const calls = events.filter(e => e.type === 'agent.completed' || e.type === 'agent.error');
  const fields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'usd'] as const;
  return Object.fromEntries(fields.map(field => {
    const values = calls.map(e => {
      const usage = e.usage as Usage | undefined;
      return field === 'usd' ? cost(usage?.[field]) : tokenCount(usage?.[field]);
    });
    return [field, {known: values.reduce<number>((sum, value) => sum + (value ?? 0), 0), missingCalls: values.filter(v => v === undefined).length}];
  }));
}
