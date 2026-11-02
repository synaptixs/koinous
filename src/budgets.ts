import type {Usage} from './core.ts';
import {tokenCount} from './provider-runtime.ts';
export type BudgetPolicy=Readonly<{maxCalls:number;maxTokens:number|null}>;
export type BudgetState={policy:BudgetPolicy;admittedCalls:number;chargedTokens:number;reservedTokens:number;unknownUsageCalls:number;breached:boolean};

export function budgetPolicy(value:unknown=undefined,env:NodeJS.ProcessEnv=process.env):BudgetPolicy {
 if(value!==undefined&&(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['maxCalls','maxTokens'].includes(k))))throw Error('Budget must contain only maxCalls and maxTokens');
 const v=(value??{}) as Record<string,unknown>;
 const parse=(x:unknown,name:string,max:number)=>{if(typeof x!=='number'||!Number.isSafeInteger(x)||x<1||x>max)throw Error(`${name} must be an integer from 1 to ${max}`);return x;};
 const serverCalls=parse(env.MAX_SESSION_CALLS===undefined?9:Number(env.MAX_SESSION_CALLS),'MAX_SESSION_CALLS',9);
 const serverTokens=env.MAX_SESSION_TOKENS===undefined?null:parse(Number(env.MAX_SESSION_TOKENS),'MAX_SESSION_TOKENS',1_000_000_000);
 const maxCalls=v.maxCalls===undefined?serverCalls:parse(v.maxCalls,'maxCalls',9);
 const maxTokens=v.maxTokens===undefined?serverTokens:v.maxTokens===null?null:parse(v.maxTokens,'maxTokens',1_000_000_000);
 if(maxCalls>serverCalls||(serverTokens!==null&&(maxTokens===null||maxTokens>serverTokens)))throw Error('Requested budget cannot exceed server limits');
 return Object.freeze({maxCalls,maxTokens});
}

// Adapter ceilings are guarantees for the entire invocation, not output-only caps.
export class BudgetLedger {
 private policy:BudgetPolicy;
 private admittedCalls=0;private chargedTokens=0;private pending=new Map<number,number>();
 private unknownUsageCalls=0;private breached=false;
 constructor(policy:BudgetPolicy){this.policy=Object.freeze({...policy});}
 snapshot():BudgetState{return {policy:this.policy,admittedCalls:this.admittedCalls,chargedTokens:this.chargedTokens,reservedTokens:[...this.pending.values()].reduce((a,b)=>a+b,0),unknownUsageCalls:this.unknownUsageCalls,breached:this.breached};}
 reserveRound(bounds:Array<number|undefined>):{tickets:number[];reason?:undefined}|{reason:string;tickets?:undefined}{
  if(this.breached)return {reason:'Provider exceeded its token ceiling; no further dispatch permitted'};
  if(this.admittedCalls+bounds.length>this.policy.maxCalls)return {reason:'Full round exceeds remaining call budget'};
  const strict=this.policy.maxTokens!==null;
  if(strict&&bounds.some(n=>tokenCount(n)===undefined))return {reason:'Strict total-token budget unavailable: adapter has no verified whole-invocation token ceiling'};
  const amounts=bounds.map(n=>strict?n!:0),reserved=amounts.reduce((a,b)=>a+b,0);
  if(!Number.isSafeInteger(reserved)||strict&&this.chargedTokens+this.snapshot().reservedTokens+reserved>this.policy.maxTokens!)return {reason:'Full round exceeds remaining token budget'};
  const tickets=amounts.map(n=>{const id=++this.admittedCalls;this.pending.set(id,n);return id;});return {tickets};
 }
 settle(ticket:number,usage?:Usage):void{
  const reserved=this.pending.get(ticket);if(reserved===undefined)throw Error('Budget reservation already settled or unknown');
  this.pending.delete(ticket);
  const input=tokenCount(usage?.inputTokens),output=tokenCount(usage?.outputTokens);
  const total=input!==undefined&&output!==undefined&&Number.isSafeInteger(input+output)?input+output:undefined;
  const known=(input??0)+(output??0);
  if(this.policy.maxTokens!==null&&known>reserved)this.breached=true;
  if(total===undefined){this.unknownUsageCalls++;this.chargedTokens+=Math.max(reserved,Number.isSafeInteger(known)?known:reserved);}
  else this.chargedTokens+=total;
 }
}

export function budgetMarkdown(state?:BudgetState):string[]{
 if(!state)return ['## Budget enforcement','','Budget enforcement was not recorded for this historical discussion.',''];
 const callBounded=state.policy.maxTokens===null;
 return ['## Budget enforcement','',`Call limit: ${state.policy.maxCalls}; admitted attempts: ${state.admittedCalls}. Entire rounds are reserved before concurrent dispatch.`,
 callBounded?'Mode: call-bounded discussion with observational token accounting; no hard token ceiling is enforced.':`Mode: strict token admission. Total-token limit: ${state.policy.maxTokens}.`,
 `${callBounded?'Known input + output tokens':'Charged tokens (including retained unknown-usage reservations)'}: ${state.chargedTokens}; outstanding token reservations: ${state.reservedTokens}; calls with unknown token usage: ${state.unknownUsageCalls}.`,
 callBounded?(state.unknownUsageCalls>0?'Token accounting is incomplete: the known sum is a lower bound, not the discussion total. Missing usage is unknown, not zero.':'No settled calls have missing input/output counters. Reported counters do not prove coverage of hidden provider work.'):'Unknown/failed usage retains the whole reservation. Strict admission requires a verified whole-invocation ceiling from every adapter.',
 'Cache and reasoning counts are breakdowns and are not added again to input + output totals.',
 state.breached?'TOKEN CEILING BREACH: adapter violated its guarantee; recorded usage may exceed the limit. Further dispatch stopped.':callBounded?'Token ceiling breach detection is not applicable in call-bounded mode.':'No adapter ceiling breach recorded.',
 'Timeouts bound local waiting; cancellation stops further application dispatch. The remote work may continue and its final usage may remain unknown.',
 'Call limits count application adapter invocation attempts, including failures; they do not claim a bound on hidden SDK retries or backend requests. Subscription USD remains unknown where unreported; known-cost thresholds are advisory, not hard monetary ceilings.',''];
}

export function validBudgetState(value:unknown):value is BudgetState{
 if(!value||typeof value!=='object')return false;
 const b=value as BudgetState;
 try{budgetPolicy(b.policy,{});}catch{return false;}
 return !!b.policy&&(b.policy.maxTokens===null||typeof b.policy.maxTokens==='number'&&Number.isSafeInteger(b.policy.maxTokens)&&b.policy.maxTokens>0)&&typeof b.breached==='boolean'&&[b.admittedCalls,b.chargedTokens,b.reservedTokens,b.unknownUsageCalls].every(n=>tokenCount(n)!==undefined)&&b.admittedCalls<=b.policy.maxCalls&&b.unknownUsageCalls<=b.admittedCalls;
}
