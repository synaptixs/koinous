import type {Usage} from './core.ts';
import {tokenCount} from './provider-runtime.ts';

// xAI PromptResponseMeta.usage / PromptUsageModel, source revision
// 2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8. Sibling counters are last-call/context,
// not prompt totals. Never sum snapshots, per-model rows, or cache breakdowns.
function record(value:unknown):Record<string,unknown>|undefined {
  return value!==null && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:undefined;
}
export function grokBuildUsage(result:unknown):Usage {
  const ledger=record(record(record(result)?._meta)?.usage);
  const usage:Usage={usd:null};
  if(!ledger || (ledger.usageIsIncomplete!==undefined && ledger.usageIsIncomplete!==false))return usage;
  const fields={inputTokens:'inputTokens',outputTokens:'outputTokens',cacheReadTokens:'cachedReadTokens',cacheWriteTokens:'cacheCreationTokens',reasoningTokens:'reasoningTokens'} as const;
  for(const [target,source] of Object.entries(fields)){
    const count=tokenCount(ledger[source]);
    if(count!==undefined)usage[target as keyof typeof fields]=count;
  }
  const ticks=tokenCount(ledger.costUsdTicks);
  // xAI omits zero/untrustworthy cost ticks. Do not interpret a zero sentinel as free.
  if(ticks!==undefined && ticks>0 &&
    (ledger.costIsPartial===undefined || ledger.costIsPartial===false)){
    usage.usd=ticks/1e10;usage.costSource='provider-reported';
  }
  return usage;
}
