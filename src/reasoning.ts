import {providerFor} from './participants.ts';
import type {ParticipantId} from './participants.ts';

// Values accepted by the pinned transports. Model catalogs may narrow this set.
export const REASONING_LEVELS = Object.freeze({
 codex:Object.freeze(['minimal','low','medium','high','xhigh','max','ultra','persistent']),
 claude:Object.freeze(['low','medium','high','xhigh','max']),
 grok:Object.freeze([] as string[]),'ollama-local':Object.freeze([] as string[]),'ollama-cloud':Object.freeze([] as string[])
});
export type ReasoningEffort=string|boolean|null;
export type Efforts=Readonly<Partial<Record<ParticipantId,ReasoningEffort>>>;
export function validateEffort(id:ParticipantId,value:unknown):ReasoningEffort {
 const provider=providerFor(id);
 if(value===null)return null;
 if(provider.startsWith('ollama-')){
  if(typeof value==='boolean'||typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value))return value;
 }else if(typeof value==='string'&&REASONING_LEVELS[provider].includes(value))return value;
 throw Error('Unsupported reasoning level for '+provider);
}
export function participantEffort(selection:{efforts?:Efforts}|undefined,id:ParticipantId,legacy?:string):ReasoningEffort {
 if(selection?.efforts&&Object.hasOwn(selection.efforts,id))return selection.efforts[id]!;
 return ['codex','claude'].includes(providerFor(id))?legacy??null:null;
}
export function effortLabel(value:ReasoningEffort|undefined):string {
 return value===undefined?'not recorded':value===null?'model default':value===true?'thinking on':value===false?'thinking off':value;
}
