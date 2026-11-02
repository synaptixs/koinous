import {AGENTS} from './core.ts';
import type {AgentId} from './core.ts';
import {ProviderFailure} from './provider-runtime.ts';

export function validateProviders(ids: readonly string[]): AgentId[] {
  if (ids.length < 2 || ids.length > AGENTS.length || new Set(ids).size !== ids.length || ids.some(id => !AGENTS.includes(id as AgentId))) {
    throw new ProviderFailure('configuration', 'KOINOUS_PROVIDERS requires at least two distinct providers from codex, claude, grok');
  }
  return [...ids] as AgentId[];
}

export function configuredProviders(value = process.env.KOINOUS_PROVIDERS): AgentId[] {
  const ids=validateProviders(value === undefined ? enabledProviders() : value.split(',').map(id => id.trim()));
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
  if(new Set(disabled).size!==disabled.length||disabled.some(id=>!AGENTS.includes(id as AgentId)))throw new ProviderFailure('configuration','Invalid KOINOUS_DISABLED_PROVIDERS');
  return AGENTS.filter(id=>!disabled.includes(id));
}
export function assertProvidersEnabled(ids:readonly AgentId[]):void {
  const enabled=enabledProviders();
  if(ids.some(id=>!enabled.includes(id)))throw new ProviderFailure('configuration','Selected provider is disabled by server configuration');
}
