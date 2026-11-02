import type {AgentId} from './core.ts';

// Stable participant identities are separate from provider authentication. Existing
// provider IDs remain the first slot, preserving historical sessions and API input.
export const PARTICIPANT_PROVIDERS = Object.freeze({codex:'codex',claude:'claude',grok:'grok','codex-2':'codex','claude-2':'claude'} as const);
export type ParticipantId = keyof typeof PARTICIPANT_PROVIDERS;
export const PARTICIPANTS = Object.freeze(Object.keys(PARTICIPANT_PROVIDERS) as ParticipantId[]);
export function providerFor(id:ParticipantId):AgentId {return PARTICIPANT_PROVIDERS[id];}
export function validateParticipants(ids:readonly string[]):ParticipantId[] {
 if(ids.length<2||ids.length>3||new Set(ids).size!==ids.length||ids.some(id=>!PARTICIPANTS.includes(id as ParticipantId)))throw Error('Select two or three distinct participants from the supported providers');
 return [...ids] as ParticipantId[];
}
