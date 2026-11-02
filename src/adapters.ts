import {validateParticipants,providerFor} from './participants.ts';
import type {ParticipantId} from './participants.ts';
import {ManagedGrokBuildAdapter} from './grok-managed.ts';
import {GrokBuildAdapter} from './grok-build.ts';
import {subscriptionEnvironment} from './provider-config.ts';
import type {Selection} from './selection.ts';
import {resolveSelection,defaultParticipants} from './selection.ts';
import {codexUsage} from './codex-usage.ts';
import type {Adapter, AgentId, Reply, Round, Usage} from './core.ts';

// Mock mode uses deterministic stand-ins, NOT AI model outputs. No external packages required.
export class MockAdapter implements Adapter {
  readonly maxTotalTokensPerCall=0; // No inference occurs in deterministic mock mode.
  id: ParticipantId;
  constructor(id: ParticipantId) { this.id=id; }
  async run(prompt: string, round: Round, signal: AbortSignal): Promise<Reply> {
    await new Promise<void>((resolve,reject)=>{
      const t=setTimeout(resolve, this.id==='codex'?400:this.id==='claude'?650:900);
      signal.addEventListener('abort',()=>{clearTimeout(t);reject(new Error('Cancelled'));},{once:true});
    });
    if (signal.aborted) throw new Error('Cancelled');
    const topic=(prompt.match(/PROBLEM:\n([^\n]+)/)?.[1] || 'the technical question').slice(0,160);
    const peerSection=prompt.split('OTHER AGENTS LAST ROUND:\n')[1]?.split('\n\nROUND ')[0]??'';
    const peers=([...peerSection.matchAll(/^(CODEX(?:-2)?|CLAUDE(?:-2)?|GROK):/gm)].map(m=>m[1].toLowerCase()) as ParticipantId[]).filter(id=>id!==this.id);
    const reviews=[...new Set(peers)].map(peer=>({peer,decision:'unresolved',reason:'Mock critique: compare the proposed pilot against workload and service-quality evidence.'}));
    const views: Record<AgentId,string>={codex:'implementation boundaries, testability, and integration cost', claude:'architecture tradeoffs, operational risk, and maintainability',grok:'counterexamples, hidden assumptions, and alternative approaches'};
    return {text: round===1?`**Mock ${this.id} independent position:** For “${topic}”, prioritize ${views[providerFor(this.id)]}.\n\n- Hypothesis: run a small controlled experiment first.\n- Evidence status: demonstration only; no actual model inference.\n- Next step: define acceptance tests and compare options.`
     :round===2?JSON.stringify({reviews,revisedView:'Mock revised view: use a reversible pilot with a stop condition.',openQuestions:['What evidence would justify a wider rollout?']})
:JSON.stringify({revisions:reviews,direction:'pilot',recommendation:`Run a small reversible pilot of “${topic}” before committing.`,rationale:'Illustrative mock recommendation; validate assumptions with actual users.',risks:['Demand and feasibility remain untested.'],disagreements:['The evidence needed for a full commitment remains unresolved.'],claims:[{id:'a1',kind:'assumption',text:'A limited pilot can test demand and feasibility.',evidenceIds:[],snapshotId:null}],nextSteps:['Define a success criterion and a limited pilot.','Review results before a wider rollout.']}),usage:{inputTokens:0,outputTokens:0,usd:0}};
  }
}

// Type-only imports keep the dependency-free mock runtime available.
import type {Thread, ThreadOptions, CodexOptions, ModelReasoningEffort} from '@openai/codex-sdk';
import type {Options, SDKMessage, Query, ModelUsage} from '@anthropic-ai/claude-agent-sdk';
import {ProviderFailure, tokenCount, cost, sumKnown, positiveNumber} from './provider-runtime.ts';

type CodexClient = {startThread(options: ThreadOptions): Pick<Thread, 'id' | 'run'>};
type ClaudeQuery = (params: {prompt: string; options: Options}) => AsyncIterable<SDKMessage> & Pick<Query, 'close'>;

export function codexReasoningEffort(value:unknown):ModelReasoningEffort|undefined {
  if(value===undefined)return;
  if(typeof value!=='string'||!['minimal','low','medium','high','xhigh','max','ultra','persistent'].includes(value))throw new ProviderFailure('configuration','Unsupported Codex reasoning effort');
  return value as ModelReasoningEffort;
}

export class CodexAdapter implements Adapter {
  id: AgentId = 'codex';
  private model: string;
  private reasoningEffort?: ModelReasoningEffort;
  private thread?: Pick<Thread, 'id' | 'run'>;
  private load: (options: CodexOptions) => Promise<CodexClient>;
  constructor(load: (options: CodexOptions) => Promise<CodexClient> = async options => new (await import('@openai/codex-sdk')).Codex(options), model = process.env.CODEX_MODEL || '', reasoningEffort?:ModelReasoningEffort) { this.load = load; this.model = model; this.reasoningEffort=codexReasoningEffort(reasoningEffort); }
  async run(prompt: string, _round: Round, signal: AbortSignal): Promise<Reply> {
    signal.throwIfAborted();
    const requestedModel = this.model || undefined;
    if (!this.thread) {
      const cli = await this.load({env: subscriptionEnvironment(), config: {forced_login_method: 'chatgpt', model_provider: 'openai'}});
      signal.throwIfAborted();
      this.thread = cli.startThread({model: requestedModel, ...(this.reasoningEffort?{modelReasoningEffort:this.reasoningEffort}:{}), workingDirectory: process.env.CODEX_WORKDIR || process.cwd(), skipGitRepoCheck: true, sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled'});
    }
    const turn = await this.thread.run(prompt, {signal});
    const u = turn.usage;
    const details = {requestedModel, sessionId: this.thread.id || undefined, usage: codexUsage(u)};
    if (!turn.finalResponse.trim()) throw new ProviderFailure('empty_response', 'Codex returned no final response', details);
    return {text: turn.finalResponse, ...details};
  }
}

export function claudeUsage(models: Record<string, ModelUsage>, usd: unknown): Usage {
  const rows = Object.values(models);
  const sum = (key: keyof ModelUsage) => sumKnown(rows.map(row => tokenCount(row[key])));
  // Anthropic inputTokens excludes cache reads/writes; normalize to total input.
  return {inputTokens: sumKnown([sum('inputTokens'), sum('cacheReadInputTokens'), sum('cacheCreationInputTokens')]),
    outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadInputTokens'), cacheWriteTokens: sum('cacheCreationInputTokens'),
    reasoningTokens: sum('thinkingTokens'), usd: cost(usd) ?? null, costSource: 'provider-estimate'};
}

export class ClaudeAdapter implements Adapter {
  id: AgentId = 'claude';
  private model: string;
  private load: () => Promise<ClaudeQuery>;
  constructor(load: () => Promise<ClaudeQuery> = async () => (await import('@anthropic-ai/claude-agent-sdk')).query, model = process.env.CLAUDE_MODEL || '') { this.load = load; this.model = model; }
  async run(prompt: string, _round: Round, signal: AbortSignal): Promise<Reply> {
    signal.throwIfAborted();
    const query = await this.load();
    signal.throwIfAborted();
    const controller = new AbortController();
    let stream: ReturnType<ClaudeQuery> | undefined;
    let closed = false;
    const close = () => { if (stream && !closed) { closed = true; stream.close(); } };
    const onAbort = () => { controller.abort(signal.reason); close(); };
    signal.addEventListener('abort', onAbort, {once: true});
    try {
      const requestedModel = this.model || undefined;
      stream = query({prompt, options: {env: subscriptionEnvironment(), settings: {forceLoginMethod: 'claudeai'}, model: requestedModel, abortController: controller, maxTurns: 1,
        maxBudgetUsd: positiveNumber('CLAUDE_MAX_CALL_USD', 0.50, false), tools: [], disallowedTools: ['*'],
        permissionMode: 'dontAsk', allowedTools: [], settingSources: [], cwd: process.env.CLAUDE_WORKDIR || process.cwd()}});
      for await (const m of stream) {
        if (m.type !== 'result') continue;
        const details = {requestedModel, model: Object.keys(m.modelUsage || {}).join(', ') || undefined,
          responseId: m.uuid, sessionId: m.session_id, usage: claudeUsage(m.modelUsage || {}, m.total_cost_usd)};
        if (m.subtype !== 'success' || m.is_error) throw new ProviderFailure('provider_error', `Claude result: ${m.subtype}`, details);
        if (!m.result.trim()) throw new ProviderFailure('empty_response', 'Claude returned no final result', details);
        return {text: m.result, ...details};
      }
      throw new ProviderFailure('empty_response', 'Claude returned no final result');
    } finally {
      signal.removeEventListener('abort', onAbort);
      close();
    }
  }
}

// Only parse public assistant text and accounting fields; never retain reasoning content.
type GrokResponse = {
  id?: string; model?: string; status?: string; error?: unknown; output_text?: string;
  output?: Array<{type?: string; content?: Array<{type?: string; text?: string}>}>;
  usage?: {cost_in_usd_ticks?: number; input_tokens?: number; output_tokens?: number; input_tokens_details?: {cached_tokens?: number}; output_tokens_details?: {reasoning_tokens?: number}};
};
export class GrokAdapter implements Adapter {
  id: AgentId = 'grok';
  private request: typeof fetch;
  constructor(request: typeof fetch = fetch) { this.request = request; }
  async run(prompt: string, _round: Round, signal: AbortSignal): Promise<Reply> {
    signal.throwIfAborted();
    const key = process.env.XAI_API_KEY;
    if (!key) throw new ProviderFailure('configuration', 'XAI_API_KEY is not set');
    const requestedModel = process.env.GROK_MODEL || 'grok-4.7';
    const effort = process.env.GROK_REASONING_EFFORT;
    if (effort !== undefined && !['low', 'medium', 'high', 'xhigh'].includes(effort)) {
      throw new ProviderFailure('configuration', 'GROK_REASONING_EFFORT must be low, medium, high, or xhigh');
    }
    const response = await this.request('https://api.x.ai/v1/responses', {method: 'POST', signal,
      headers: {'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({model: requestedModel, input: [{role: 'user', content: prompt}], max_output_tokens: positiveNumber('GROK_MAX_OUTPUT_TOKENS', 1200), ...(effort === undefined ? {} : {reasoning: {effort}}), store: false})});
    // Error bodies can contain credentials or echoed prompts; never put them in audit logs.
    if (!response.ok) throw new ProviderFailure('http_error', `Grok API HTTP ${response.status}`);
    const result: GrokResponse = await response.json();
    if (!result || typeof result !== 'object') throw new ProviderFailure('invalid_response', 'Invalid Grok response');
    const details = {requestedModel, model: result.model, responseId: result.id, usage: {
      inputTokens: tokenCount(result.usage?.input_tokens), outputTokens: tokenCount(result.usage?.output_tokens),
      cacheReadTokens: tokenCount(result.usage?.input_tokens_details?.cached_tokens), reasoningTokens: tokenCount(result.usage?.output_tokens_details?.reasoning_tokens),
      usd: tokenCount(result.usage?.cost_in_usd_ticks) === undefined ? null : result.usage!.cost_in_usd_ticks! / 1e10, costSource: 'provider-reported' as const,
    }};
    if (result.error || result.status !== 'completed') throw new ProviderFailure('incomplete_response', 'Grok response did not complete', details);
    const content = typeof result.output_text === 'string' ? result.output_text : (Array.isArray(result.output) ? result.output : [])
      .filter(item => item.type === 'message').flatMap(item => Array.isArray(item.content) ? item.content : [])
      .filter(item => item.type === 'output_text' && typeof item.text === 'string').map(item => item.text).join('\n');
    if (!content.trim()) throw new ProviderFailure('empty_response', 'Grok returned no output text', details);
    return {text: content, ...details};
  }
}
export function createAdapters(mode: string, providers: readonly ParticipantId[] = defaultParticipants(), models?: Selection['models'], reasoningEffort?:ModelReasoningEffort): Adapter[] {
  const effort=codexReasoningEffort(reasoningEffort);
  const roster = validateParticipants(providers);
  const selection = models === undefined ? resolveSelection({providers: roster}) : resolveSelection({providers: roster, models}, {providers: roster, models});
  if (!['mock', 'real'].includes(mode)) throw new ProviderFailure('configuration', 'MODE must be mock or real');
  if (mode === 'real' && roster.includes('grok') && (process.env.GROK_TRANSPORT || 'build') !== 'build') {
    throw new ProviderFailure('configuration', 'Subscription mode requires GROK_TRANSPORT=build; API-key fallback is disabled');
  }
  return roster.map(id => {
    if(mode==='mock')return new MockAdapter(id);
    const provider=providerFor(id);
    // One fresh SDK adapter (and therefore conversation) per participant. Only
    // authentication is shared; each call retains its own selected model/usage.
    const adapter:Adapter=provider==='codex'?new CodexAdapter(undefined,selection.models[id],effort):provider==='claude'?new ClaudeAdapter(undefined,selection.models[id]):((process.env.GROK_BUILD_RUNTIME||'managed-vm')==='managed-vm'?new ManagedGrokBuildAdapter(selection.models[id]):new GrokBuildAdapter(selection.models[id]));
    if(id===provider)return adapter;
    return {id,maxTotalTokensPerCall:adapter.maxTotalTokensPerCall,run:adapter.run.bind(adapter),...(adapter.prepare?{prepare:adapter.prepare.bind(adapter)}:{}),...(adapter.dispose?{dispose:adapter.dispose.bind(adapter)}:{})};
  });
}
