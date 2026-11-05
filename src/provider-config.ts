import {providerFor} from './participants.ts';
import type {ParticipantId} from './participants.ts';
import {AGENTS,SUPPORTED_PROVIDERS} from './core.ts';
import type {AgentId} from './core.ts';
import {ProviderFailure} from './provider-runtime.ts';

export function validateProviders(ids: readonly string[]): AgentId[] {
  if (ids.length < 2 || ids.length > 3 || new Set(ids).size !== ids.length || ids.some(id => !SUPPORTED_PROVIDERS.includes(id as AgentId))) {
    throw new ProviderFailure('configuration', 'KOINOUS_PROVIDERS requires two or three distinct supported providers');
  }
  return [...ids] as AgentId[];
}

export function configuredProviders(value = process.env.KOINOUS_PROVIDERS): AgentId[] {
  const raw=value === undefined ? AGENTS.filter(id=>enabledProviders().includes(id)) : value.split(',').map(id => id.trim());
  const ids=raw.length===1&&SUPPORTED_PROVIDERS.includes(raw[0] as AgentId)?raw as AgentId[]:validateProviders(raw);
  assertProvidersEnabled(ids);return ids;
}

// SDK env replaces the inherited environment. Keep local login locations and OS
// essentials; never forward API keys, bearer tokens, endpoint or cloud overrides.
export function subscriptionEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'COMSPEC', 'PATHEXT', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR']) {
    if (source[key] !== undefined) result[key] = source[key]!;
  }
  return result;
}

// Availability is separate from structural selection validation: saved sessions
// remain readable even when one of their historical providers is disabled.
export function enabledProviders(value=process.env.KOINOUS_DISABLED_PROVIDERS): AgentId[] {
  const disabled=value===undefined||value.trim()===''?[]:value.split(',').map(id=>id.trim());
  if(new Set(disabled).size!==disabled.length||disabled.some(id=>!SUPPORTED_PROVIDERS.includes(id as AgentId)))throw new ProviderFailure('configuration','Invalid KOINOUS_DISABLED_PROVIDERS');
  return SUPPORTED_PROVIDERS.filter(id=>!disabled.includes(id));
}
export function assertProvidersEnabled(ids:readonly ParticipantId[]):void {
  const enabled=enabledProviders();
  if(ids.some(id=>!enabled.includes(providerFor(id))))throw new ProviderFailure('configuration','Selected provider is disabled by server configuration');
}
