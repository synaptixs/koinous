import {PARTICIPANTS,providerFor,validateParticipants} from './participants.ts';
import type {ParticipantId} from './participants.ts';
import type {AgentId} from './core.ts';
import {configuredProviders} from './provider-config.ts';

// Legacy wire names are retained: providers contains participant IDs, and models
// is keyed by those IDs. Provider ownership is defined in participants.ts.
export type Selection = Readonly<{providers: readonly ParticipantId[]; models: Readonly<Partial<Record<ParticipantId, string>>>}>;

function modelId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || (value !== '' && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(value))) {
    throw new Error('Model IDs must be empty for the default, or 1–128 letters, digits, dots, underscores, colons, slashes or hyphens');
  }
  return value;
}

export function modelDefaults(env: NodeJS.ProcessEnv = process.env): Record<AgentId, string> {
  return {codex: modelId(env.CODEX_MODEL || ''), claude: modelId(env.CLAUDE_MODEL || ''), grok: modelId(env.GROK_BUILD_MODEL || 'grok-4.7'),'ollama-local':modelId(env.OLLAMA_LOCAL_MODEL||''),'ollama-cloud':modelId(env.OLLAMA_CLOUD_MODEL||'')};
}

export function defaultParticipants():ParticipantId[] {
  const providers=configuredProviders();
  return providers.length===1&&providers[0]!=='grok'?[providers[0],`${providers[0]}-2` as ParticipantId]:providers;
}

// Only server UI defaults may contain unfinished model choices. Dispatch and
// saved-session validation always use the strict default (false).
export function resolveSelection(input: unknown, defaults: Selection = {providers: defaultParticipants(), models: modelDefaults()}, allowUnspecifiedModels=false): Selection {
  if (input === undefined) input = {providers: defaults.providers};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Selection must contain providers and optional models');
  const obj = input as Record<string, unknown>;
  if (Object.keys(obj).some(key => !['providers', 'models'].includes(key))) throw new Error('Selection accepts only providers and models; authentication is fixed to subscription login');
  if (!Array.isArray(obj.providers) || obj.providers.some(id => typeof id !== 'string')) throw new Error('Select at least two distinct participants');
  const providers = validateParticipants(obj.providers);
  const requested = obj.models === undefined ? {} : obj.models;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) throw new Error('Models must be keyed by selected participant');
  const models: Partial<Record<ParticipantId, string>> = {};
  for (const [id, value] of Object.entries(requested)) {
    if (!PARTICIPANTS.includes(id as ParticipantId) || !providers.includes(id as ParticipantId)) throw new Error('Model overrides must belong to selected participants');
    modelId(value);
  }
  for (const id of providers) {
    const requestedModel = (requested as Record<string, unknown>)[id];
    models[id] = modelId(requestedModel === undefined || requestedModel === '' ? defaults.models[id] || '' : requestedModel);
  }
  for(const id of providers) {
    if(!allowUnspecifiedModels&&providerFor(id).startsWith('ollama-')&&!models[id])throw Error('Choose an explicit Ollama model ID');
    const peers=providers.filter(other=>other!==id&&providerFor(other)===providerFor(id));
    if(peers.length&&((!allowUnspecifiedModels&&(!models[id]||peers.some(other=>!models[other])))||peers.some(other=>models[id]&&models[other]===models[id])))throw Error('Participants using the same provider require two explicit, different model IDs');
  }
  return Object.freeze({providers: Object.freeze(providers), models: Object.freeze(models)});
}
