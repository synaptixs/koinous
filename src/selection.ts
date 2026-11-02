import {AGENTS} from './core.ts';
import type {AgentId} from './core.ts';
import {configuredProviders, validateProviders} from './provider-config.ts';

export type Selection = Readonly<{providers: readonly AgentId[]; models: Readonly<Partial<Record<AgentId, string>>>}>;

function modelId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || (value !== '' && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value))) {
    throw new Error('Model IDs must be empty for the default, or 1–128 letters, digits, dots, underscores, colons, slashes or hyphens');
  }
  return value;
}

export function modelDefaults(env: NodeJS.ProcessEnv = process.env): Record<AgentId, string> {
  return {codex: modelId(env.CODEX_MODEL || ''), claude: modelId(env.CLAUDE_MODEL || ''), grok: modelId(env.GROK_BUILD_MODEL || 'grok-4.7')};
}

export function resolveSelection(input: unknown, defaults: Selection = {providers: configuredProviders(), models: modelDefaults()}): Selection {
  if (input === undefined) input = {providers: defaults.providers};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Selection must contain providers and optional models');
  const obj = input as Record<string, unknown>;
  if (Object.keys(obj).some(key => !['providers', 'models'].includes(key))) throw new Error('Selection accepts only providers and models; authentication is fixed to subscription login');
  if (!Array.isArray(obj.providers) || obj.providers.some(id => typeof id !== 'string')) throw new Error('Select at least two distinct providers');
  const providers = validateProviders(obj.providers);
  const requested = obj.models === undefined ? {} : obj.models;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new Error('Models must be keyed by selected provider');
  const models: Partial<Record<AgentId, string>> = {};
  for (const [id, value] of Object.entries(requested)) {
    if (!AGENTS.includes(id as AgentId) || !providers.includes(id as AgentId)) throw new Error('Model overrides must belong to selected providers');
    modelId(value);
  }
  for (const id of providers) {
    const requestedModel = (requested as Record<string, unknown>)[id];
    models[id] = modelId(requestedModel === undefined || requestedModel === '' ? defaults.models[id] || '' : requestedModel);
  }
  return Object.freeze({providers: Object.freeze(providers), models: Object.freeze(models)});
}
