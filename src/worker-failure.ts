import {ProviderFailure,tokenCount,cost} from './provider-runtime.ts';
import type {Usage} from './core.ts';
// Failed worker replies retain only safe accounting. SDK messages, stderr, prompt
// echoes, paths and arbitrary exception properties never enter the wire response.
export function workerFailure(error:unknown){
 const details=error instanceof ProviderFailure?error.details:undefined;
 const supplied=details?.usage,usage:Usage={usd:cost(supplied?.usd)??null};
 for(const field of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'] as const){const n=tokenCount(supplied?.[field]);if(n!==undefined)usage[field]=n;}
 if(supplied?.costSource==='provider-estimate'||supplied?.costSource==='provider-reported')usage.costSource=supplied.costSource;
 const permitted=['empty_response','provider_error','invalid_response','incomplete_response','cancelled','timeout'];
 const code=error instanceof ProviderFailure&&permitted.includes(error.code)?error.code:'provider_error';
 return {ok:false as const,error:'sdk_worker_failed' as const,code,usage};
}
