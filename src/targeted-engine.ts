import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Adapter,Session,Round} from './core.ts';
import {makeReport} from './core.ts';
import {BudgetLedger} from './budgets.ts';
import {ProviderFailure,withDeadline,callTimeoutMs,cost,usageSummary} from './provider-runtime.ts';
import {providerFor} from './participants.ts';
import type {ParticipantId} from './participants.ts';
import {researchEvidence} from './research.ts';
import {getEvidence} from './grounding.ts';
import {assessTargeted,targetedPrompt,parseDraftText,parseTargetedReview,materialFindings,parseRevision} from './targeted-review.ts';
import {tokenAccounting} from './token-accounting.ts';
export type StageRequest={agent:ParticipantId;effort:'low'|'medium'};
export type AdapterFactory=(session:Session,stage?:StageRequest)=>Adapter[];
export async function runTargeted(s:Session,factory:AdapterFactory,emit:(s:Session,type:string,data?:Record<string,unknown>)=>void,outputDir:string,researcher:typeof researchEvidence=researchEvidence){
 const config=s.targetedConfig!,ledger=new BudgetLedger({...s.budgetPolicy!,maxCalls:Math.min(3,s.budgetPolicy!.maxCalls)}),used=new Set<Adapter>(),started=performance.now();
 s.status='running';s.participants=[...s.selection!.providers];s.budget=ledger.snapshot();
 emit(s,'session.started');emit(s,'participants.configured',{agents:s.participants,maxCalls:s.budget.policy.maxCalls,selection:s.selection});
 const invoke=async(agent:ParticipantId,round:Round,stage:'draft'|'review'|'revision',prompt:string)=>{
  s.cancel.signal.throwIfAborted();
  if(s.spendKnownUSD>=Number(process.env.MAX_SESSION_USD||3))throw new ProviderFailure('budget_denied','Known-cost advisory threshold reached');
  const roster=factory(s,{agent,effort:stage==='review'?'medium':'low'});
  if(roster.length!==s.selection!.providers.length||roster.some((a,i)=>a.id!==s.selection!.providers[i]))throw Error('Adapter roster differs from session selection');
  const adapter=roster.find(a=>a.id===agent)!;
  if(used.has(adapter))throw Error('Targeted stages require fresh adapter instances');used.add(adapter);
  const reservation=ledger.reserveRound([adapter.maxTotalTokensPerCall]);s.budget=ledger.snapshot();
  if(!reservation.tickets){emit(s,'budget.denied',{round,stage,reason:reservation.reason,budget:s.budget});throw new ProviderFailure('budget_denied',reservation.reason);}
  const ticket=reservation.tickets[0];let settled=false,dispatched=false;
  const reconcile=(usage?:import('./core.ts').Usage)=>{if(settled)return;settled=true;ledger.settle(ticket,usage);s.budget=ledger.snapshot();emit(s,'budget.reconciled',{round,agent,stage,budget:s.budget});};
  const callStart=performance.now();
  try{
   if(adapter.prepare){emit(s,'runtime.preparing',{agent,stage});await withDeadline(signal=>adapter.prepare!(signal),s.cancel.signal,callTimeoutMs(providerFor(agent)));emit(s,'runtime.ready',{agent,stage});}
   s.cancel.signal.throwIfAborted();emit(s,'round.started',{round,stage,agents:[agent]});s.calls++;dispatched=true;emit(s,'agent.started',{agent,round,stage,call:s.calls});
   const reply=await withDeadline(signal=>adapter.run(prompt,round,signal),s.cancel.signal,callTimeoutMs(providerFor(agent)));
   reconcile(reply.usage);
   const entry={...reply,agent,round,stage,durationMs:Math.round(performance.now()-callStart)};s.entries.push(entry);
   const usd=cost(reply.usage?.usd);if(usd===undefined)s.spendIncomplete=true;else s.spendKnownUSD+=usd;
   emit(s,'agent.completed',{...entry,spendKnownUSD:s.spendKnownUSD,spendIncomplete:s.spendIncomplete});
   if(ledger.snapshot().breached)throw new ProviderFailure('budget_denied','Token ceiling breached; no further dispatch');
   emit(s,'round.completed',{round,stage,succeeded:[agent]});return reply.text;
  }catch(error){
   if(!settled){const details=error instanceof ProviderFailure?error.details:{};reconcile(dispatched?details.usage:{inputTokens:0,outputTokens:0});
    if(dispatched){const usd=cost(details.usage?.usd);if(usd===undefined)s.spendIncomplete=true;else s.spendKnownUSD+=usd;
     emit(s,'agent.error',{agent,round,stage,...details,code:error instanceof ProviderFailure?error.code:'provider_error',error:'Provider call failed; no retry',durationMs:Math.round(performance.now()-callStart)});}}
   throw error;
  }finally{
   if(adapter.dispose){emit(s,'runtime.cleaning',{agent,stage});try{await withDeadline(async()=>adapter.dispose!(),new AbortController().signal,5000);emit(s,'runtime.cleaned',{agent,stage});}catch{throw new ProviderFailure('cleanup_failed','Runtime cleanup unverified; further dispatch stopped');}}
  }
 };
 try{
  s.cancel.signal.throwIfAborted();
  if(s.research){emit(s,'research.started',{query:s.research.query});s.evidence=await researcher(s.research,s.cancel.signal);emit(s,'research.completed',{query:s.research.query,snapshotId:s.evidence.snapshotId,sha256:s.evidence.hash,sources:s.evidence.items});}
  else if(s.grounding==='configured'){s.evidence=await getEvidence(s.prompt,s.cancel.signal);emit(s,'grounding.pinned',{snapshotId:s.evidence.snapshotId,sha256:s.evidence.hash,source:s.evidence.source,itemCount:s.evidence.items.length});}
  else emit(s,'grounding.skipped',{reason:'Idea and supplied context only'});
  if(s.evidence)emit(s,'evidence.snapshot',{evidence:s.evidence});
  const draft=parseDraftText(await invoke(config.author,1,'draft',targetedPrompt(s,'draft')));
  if(!draft)throw new ProviderFailure('invalid_response','Invalid draft; original response preserved');
  const review=parseTargetedReview(await invoke(config.reviewer,2,'review',targetedPrompt(s,'review',draft)),draft);
  if(!review)throw new ProviderFailure('invalid_response','Invalid review; no revision or repair dispatched');
  const findings=materialFindings(review);emit(s,'revision.decided',{required:findings.length>0,findingIds:findings.map(f=>f.id),reason:findings.length?'Material actionable findings require an author response':'No material actionable findings; retain original draft'});
  if(findings.length&&!parseRevision(await invoke(config.author,3,'revision',targetedPrompt(s,'revision',draft,review)),draft,findings))throw new ProviderFailure('invalid_response','Invalid revision or missing finding responses; original retained');
  s.cancel.signal.throwIfAborted();s.status='completed';
 }catch(error){s.status=s.cancel.signal.aborted?'cancelled':error instanceof ProviderFailure&&['invalid_response','budget_denied'].includes(error.code)?'partial':'failed';emit(s,'discussion.stopped',{reason:error instanceof ProviderFailure?error.message:'Targeted workflow stopped; no retry',code:error instanceof ProviderFailure?error.code:'setup_error'});}
 s.budget=ledger.snapshot();s.targeted=assessTargeted(s);emit(s,'targeted.assessed',{targeted:s.targeted});
 s.report=makeReport(s);writeFileSync(join(outputDir,s.id,'report.md'),s.report);
 emit(s,'session.finished',{status:s.status,calls:s.calls,budget:s.budget,usage:usageSummary(s.events),tokenAccounting:tokenAccounting(s.events),durationMs:Math.round(performance.now()-started),spendKnownUSD:s.spendKnownUSD,spendIncomplete:s.spendIncomplete});
}
