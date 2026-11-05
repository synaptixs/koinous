import type {Event,Usage} from './core.ts';
import {tokenCount} from './provider-runtime.ts';

export type ModelAccounting={primary:Usage|null;auxiliary:Record<string,Usage>;unclassified:Record<string,Usage>;auxiliaryVisibility:'reported'|'not-reported'};
export function modelAccounting(requested:string|undefined,names:string[],models:Record<string,Usage>):ModelAccounting {
 const unique=[...new Set(names)];
 const primary=unique.length===1&&Object.hasOwn(models,unique[0])?unique[0]:requested&&Object.hasOwn(models,requested)?requested:null;
 return {primary:primary?models[primary]:null,
  auxiliary:Object.fromEntries(Object.entries(models).filter(([name])=>name!==primary&&/haiku/i.test(name))),
  unclassified:Object.fromEntries(Object.entries(models).filter(([name])=>name!==primary&&!/haiku/i.test(name))),auxiliaryVisibility:'reported'};
}
const total=(u:Usage|undefined|null):number|null=>{
 const i=tokenCount(u?.inputTokens),o=tokenCount(u?.outputTokens);return i===undefined||o===undefined||!Number.isSafeInteger(i+o)?null:i+o;
};
const sum=(rows:Array<number|null>):number|null=>rows.some(n=>n===null)?null:rows.reduce<number>((s,n)=>s+n!,0);
// Canonical rows for API, saved views and exports. Unknown is never replaced with zero.
export function tokenAccounting(events:Event[]){
 const calls=events.filter(e=>['agent.completed','agent.error'].includes(e.type)).map(e=>{
  const u=e.usage as Usage|undefined,raw=e.accounting as ModelAccounting|undefined;
  const record=(v:unknown)=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const a=raw&&record(raw.auxiliary)&&record(raw.unclassified)&&(raw.primary===null||record(raw.primary))?raw:undefined;
  const auxiliary=a?.auxiliaryVisibility==='reported'?sum(Object.values(a.auxiliary).map(total)):null;
  const unclassified=a?.auxiliaryVisibility==='reported'?sum(Object.values(a.unclassified).map(total)):null;
  return {agent:String(e.agent),stage:['draft','review','revision'].includes(String(e.stage))?String(e.stage):`Round ${e.round}`,round:Number(e.round),
   inputTokens:tokenCount(u?.inputTokens)??null,outputTokens:tokenCount(u?.outputTokens)??null,totalTokens:total(u),
   primaryTokens:a?total(a.primary):null,auxiliaryTokens:auxiliary,unclassifiedTokens:unclassified,
   durationMs:tokenCount(e.durationMs)??null,status:e.type==='agent.completed'?'completed':'failed',
   auxiliaryVisibility:a?.auxiliaryVisibility??'not-reported'};
 });
 const knownTotalTokens=calls.reduce((s,c)=>s+(c.inputTokens??0)+(c.outputTokens??0),0),missingCalls=calls.filter(c=>c.totalTokens===null).length;
 return {calls,knownTotalTokens,missingCalls,scope:'Reported input + output, including cached input and reported helpers. Cache/reasoning are subsets. Missing or unreported usage is unknown. USD is not a subscription invoice.'};
}
export function tokenAccountingMarkdown(events:Event[]):string[]{
 const a=tokenAccounting(events),show=(v:number|null)=>v===null?'unknown':String(v);
 const safe=(s:string)=>s.replace(/[\r\n]+/g,' ').replace(/\|/g,'\\|').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 return ['## Per-call token accounting','',`${a.knownTotalTokens} known total tokens; ${a.missingCalls} call(s) missing input/output usage.`,a.scope,'',
  '| Participant | Stage | Input | Output | Total | Primary | Helpers | Unclassified | Latency ms |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ...a.calls.map(c=>`| ${safe(c.agent)} | ${safe(c.stage)} | ${show(c.inputTokens)} | ${show(c.outputTokens)} | ${show(c.totalTokens)} | ${show(c.primaryTokens)} | ${show(c.auxiliaryTokens)} | ${show(c.unclassifiedTokens)} | ${show(c.durationMs)} |`),''];
}
