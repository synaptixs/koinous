import {researchRequest,researchEvidence} from './research.ts';
import {workflowAssessment,responseValidation} from './discussion-workflow.ts';
import {budgetPolicy,BudgetLedger} from './budgets.ts';
import {parsePosition,assessDiscussion} from './discussion-outcome.ts';
import {randomUUID} from 'node:crypto';
import {mkdirSync, appendFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {composePrompt,makeReport} from './core.ts';
import type {Adapter,Event,Session,Round} from './core.ts';
import {withDeadline, callTimeoutMs, ProviderFailure, cost, usageSummary} from './provider-runtime.ts';
import {getEvidence} from './grounding.ts';

import {resolveSelection} from './selection.ts';
import type {Selection} from './selection.ts';
import {validateParticipants,providerFor} from './participants.ts';
const MAX_USD=Number(process.env.MAX_SESSION_USD || '3');
export class Engine extends EventEmitter {
  sessions=new Map<string,Session>();
  private createAdapters: (session: Session) => Adapter[]; private outputDir: string; private researcher:typeof researchEvidence;
  // The factory must return fresh instances: adapters may retain provider conversations.
  constructor(createAdapters:(session: Session)=>Adapter[],outputDir:string,researcher:typeof researchEvidence=researchEvidence) {super();this.researcher=researcher;this.createAdapters=createAdapters;this.outputDir=outputDir;mkdirSync(outputDir,{recursive:true});}
  create(prompt:string,maxRounds=3,selection?:Selection,options:{context?:unknown;grounding?:unknown;budget?:unknown;research?:unknown}={}):Session{
    const policy=budgetPolicy(options.budget);
    const research=researchRequest(options.research);
    const snapshot=selection===undefined?undefined:resolveSelection(selection,selection);
    if(!prompt.trim()||prompt.length>6000)throw new Error('Question must contain 1–6000 characters');
    if(![1,2,3].includes(maxRounds)) throw new Error('Rounds must be 1, 2, or 3');
    if(options.context!==undefined&&(typeof options.context!=='string'||options.context.length>6000))throw Error('Context must be text up to 6000 characters');
    const context=typeof options.context==='string'?options.context.trim():'';
    const grounding=options.grounding??'none';
    if(grounding!=='none'&&grounding!=='configured')throw Error('Grounding must be none or configured');
    if(research&&grounding!=='none')throw Error('Choose research or configured grounding, not both');
    const id=randomUUID();const s:Session={id,prompt:prompt.trim(),maxRounds,research,context,grounding,selection:snapshot,status:'created',events:[],entries:[],interventions:[],calls:0,spendKnownUSD:0,spendIncomplete:false,cancel:new AbortController()};
    Object.defineProperty(s,'budgetPolicy',{value:policy,enumerable:true,writable:false});
    Object.defineProperty(s,'research',{value:research,enumerable:true,writable:false});
    Object.defineProperty(s,'context',{value:context,enumerable:true,writable:false});
    Object.defineProperty(s,'grounding',{value:grounding,enumerable:true,writable:false});
    Object.defineProperty(s,'selection',{value:snapshot,enumerable:true,writable:false});
    this.sessions.set(id,s);mkdirSync(join(this.outputDir,id));this.emitEvent(s,'session.created',{prompt:s.prompt,maxRounds,selection:s.selection,context:s.context,grounding:s.grounding,research,budgetPolicy:policy});
    return s;
  }
  emitEvent(s:Session,type:string,data:Record<string,unknown>={}){
    const evt:Event={seq:s.events.length+1,at:new Date().toISOString(),type,...data};
    s.events.push(evt);appendFileSync(join(this.outputDir,s.id,'events.jsonl'),JSON.stringify(evt)+'\n');
    this.emit(s.id,evt);
  }
  intervene(s:Session,message:string){
    if(!['created','running'].includes(s.status))throw new Error('Session is not active');
    if(!message.trim()||message.length>1000) throw new Error('Intervention must contain 1–1000 characters');
    s.interventions.push(message.trim());this.emitEvent(s,'human.intervention',{message:message.trim(),note:'Included at next discussion round boundary, if any'});
  }
  cancel(s:Session){if(s.status==='running'||s.status==='created'){s.cancel.abort();this.emitEvent(s,'cancel.requested');}}
  async run(s:Session){
    if(this.sessions.get(s.id)!==s || s.status!=='created')throw new Error('Session can only run once on its owning engine');
    s.status='running'; this.emitEvent(s,'session.started');
    let adapters:Adapter[]=[];
    let ledger:BudgetLedger|undefined=new BudgetLedger(s.budgetPolicy!);
    s.budget=ledger.snapshot();
    try{
      if(s.cancel.signal.aborted)throw new Error('Cancelled');
      adapters=this.createAdapters(s);
      if(s.selection && (adapters.length!==s.selection.providers.length || adapters.some((a,i)=>a.id!==s.selection!.providers[i])))throw new Error('Adapter roster differs from session selection');
      s.participants=validateParticipants(adapters.map(a=>a.id));
      const maxCalls=Math.min(s.budgetPolicy!.maxCalls,s.participants.length*s.maxRounds);
      ledger=new BudgetLedger({...s.budgetPolicy!,maxCalls});s.budget=ledger.snapshot();
      this.emitEvent(s,'participants.configured',{agents:s.participants,maxCalls,selection:s.selection});
      const preflight=new BudgetLedger(s.budget.policy).reserveRound(adapters.map(a=>a.maxTotalTokensPerCall));
      if(!preflight.tickets){
        this.emitEvent(s,'budget.denied',{reason:preflight.reason,budget:s.budget});
        throw new ProviderFailure('budget_denied','Budget preflight refused dispatch before runtime preparation');
      }
      const timeouts = new Map(adapters.map(a => [a.id, callTimeoutMs(providerFor(a.id))]));
      if(s.research){
        this.emitEvent(s,'research.started',{query:s.research.query});
        s.evidence=await this.researcher(s.research,s.cancel.signal);
        this.emitEvent(s,'research.completed',{query:s.research.query,snapshotId:s.evidence.snapshotId,sha256:s.evidence.hash,sources:s.evidence.items});
      }else if(s.grounding==='configured'){
        s.evidence=await getEvidence(s.prompt,s.cancel.signal);
        this.emitEvent(s,'grounding.pinned',{snapshotId:s.evidence.snapshotId,sha256:s.evidence.hash,source:s.evidence.source,itemCount:s.evidence.items.length,publication:s.evidence.publication??null});
      }else this.emitEvent(s,'grounding.skipped',{reason:'Idea-only discussion; external grounding is opt-in'});
      for(const adapter of adapters)if(adapter.prepare){
        this.emitEvent(s,'runtime.preparing',{agent:adapter.id});
        await adapter.prepare(s.cancel.signal);
        this.emitEvent(s,'runtime.ready',{agent:adapter.id});
      }
      for(let r=1;r<=s.maxRounds;r++){
        if(s.cancel.signal.aborted)throw new Error('Cancelled');
        const round=r as Round;
        // A selected participant is required: never silently continue with survivors.
        const active=adapters;
        const roundAbort=new AbortController();
        const roundSignal=AbortSignal.any([s.cancel.signal,roundAbort.signal]);
        let providerFailed=false;
        if (active.length<2){s.status='partial';this.emitEvent(s,'discussion.stopped',{reason:'Fewer than two viable agents'});break;}
        if(s.spendKnownUSD>=MAX_USD){s.status='partial';this.emitEvent(s,'budget.denied',{round,reason:'Known-cost advisory threshold reached'});break;}
        const prompts=active.map(a=>composePrompt(s,a.id,round,'Keep the response under about 450 words.'));
        const reservation=ledger.reserveRound(active.map(a=>a.maxTotalTokensPerCall));
        s.budget=ledger.snapshot();
        if(!reservation.tickets){s.status='partial';this.emitEvent(s,'budget.denied',{round,reason:reservation.reason,budget:s.budget});break;}
        this.emitEvent(s,'budget.reserved',{round,budget:s.budget});
        this.emitEvent(s,'round.started',{round,agents:active.map(a=>a.id)});
        // Prompts are frozen at the beginning of each round: no race-dependent peer exposure.
        await Promise.all(active.map(async (adapter,i)=>{
          const ticket=reservation.tickets[i];
          if(roundSignal.aborted){ledger!.settle(ticket,{inputTokens:0,outputTokens:0});s.budget=ledger!.snapshot();return;}
          let settled=false;
          const reconcile=(usage?:import('./core.ts').Usage)=>{if(settled)return;settled=true;ledger!.settle(ticket,usage);s.budget=ledger!.snapshot();this.emitEvent(s,'budget.reconciled',{round,agent:adapter.id,budget:s.budget});};
          const started = performance.now();
          s.calls++;this.emitEvent(s,'agent.started',{round,agent:adapter.id,call:s.calls});
          try{
            const result=await withDeadline(signal => adapter.run(prompts[i],round,signal), roundSignal, timeouts.get(adapter.id)!);
            reconcile(result.usage);
            const durationMs = Math.round(performance.now() - started);
            const validation=responseValidation({round,text:result.text});
            const position=round===3?parsePosition(result.text):undefined;
            s.entries.push({round,agent:adapter.id,...result,durationMs,...(validation?{validation}:{}),...(round===3?{position}: {})});
            if(validation)this.emitEvent(s,'response.validated',{agent:adapter.id,round,validation});
            if(round===3&&!position)this.emitEvent(s,'position.invalid',{agent:adapter.id,reason:'Final response did not match the position schema; reply and usage retained',validation});
            if(cost(result.usage?.usd)!==undefined)s.spendKnownUSD+=result.usage!.usd!;
            else s.spendIncomplete=true;
            this.emitEvent(s,'agent.completed',{round,agent:adapter.id,...result,durationMs,...(validation?{validation}:{}),...(round===3?{position}:{}),spendKnownUSD:s.spendKnownUSD,spendIncomplete:s.spendIncomplete});
          }catch(e){
            const details = e instanceof ProviderFailure ? e.details : {};
            reconcile(details.usage);
            const reportedCost = cost(details.usage?.usd);
            if(reportedCost !== undefined)s.spendKnownUSD += reportedCost;
            else s.spendIncomplete = true;
            this.emitEvent(s,'agent.error',{round,agent:adapter.id,...details,
              durationMs:Math.round(performance.now()-started), code:e instanceof ProviderFailure?e.code:'provider_error',
              error:e instanceof ProviderFailure?e.message:'Provider call failed; usage may be incomplete',
              spendKnownUSD:s.spendKnownUSD,spendIncomplete:s.spendIncomplete});
            if(!providerFailed&&!s.cancel.signal.aborted){
              providerFailed=true;
              this.emitEvent(s,'discussion.stopped',{round,agent:adapter.id,code:e instanceof ProviderFailure?e.code:'provider_error',reason:'Selected provider failed; aborting remaining calls and stopping before another round'});
              roundAbort.abort();
            }
          }
        }));
        if (s.cancel.signal.aborted)throw new Error('Cancelled');
        if(providerFailed){s.status='partial';break;}
        if(ledger.snapshot().breached){s.status='failed';this.emitEvent(s,'budget.denied',{round,reason:'Provider token ceiling breached; further dispatch stopped',budget:ledger.snapshot()});break;}
        this.emitEvent(s,'round.completed',{round,succeeded:s.entries.filter(e=>e.round===round).map(e=>e.agent)});
        if(s.entries.filter(e=>e.round===round).length<2){
          s.status='partial';this.emitEvent(s,'discussion.stopped',{round,reason:'Fewer than two viable agents'});break;
        }
      }
      if(s.status==='running')s.status='completed';
    }catch(e){s.status=s.cancel.signal.aborted?'cancelled':e instanceof ProviderFailure&&e.code==='budget_denied'?'partial':'failed';this.emitEvent(s,'session.error',{error:String(e instanceof Error?e.message:e)});}
    finally{
      const outcome=s.status;s.status='cleaning';
      let cleanupFailed=false;
      for(const adapter of adapters.slice().reverse())if(adapter.dispose){
        this.emitEvent(s,'runtime.cleaning',{agent:adapter.id});
        try{await adapter.dispose();this.emitEvent(s,'runtime.cleaned',{agent:adapter.id});}
        catch{ cleanupFailed=true;this.emitEvent(s,'session.error',{agent:adapter.id,error:'Runtime cleanup unverified; recovery required before another managed discussion'}); }
      }
      s.status=cleanupFailed?'failed':outcome;
    }
    if(ledger)s.budget=ledger.snapshot();
    s.outcome=assessDiscussion(s);
    const workflow=workflowAssessment(s);
    for(const row of workflow.rows)for(const revision of row.responded)if(revision.decision==='unresolved')s.outcome.unresolved.push({agent:row.agent,text:`Unresolved critique from ${revision.peer}: ${revision.reason}`});
    if(s.outcome.status==='agreement'&&s.outcome.unresolved.length)s.outcome.status='direction-alignment';
    if(!workflow.complete){
      s.outcome.caveat+=' Peer review/revision coverage is incomplete or unassessed.';
      if(s.outcome.status==='agreement')s.outcome.status='direction-alignment';
    }
    this.emitEvent(s,'workflow.assessed',{workflow});
    this.emitEvent(s,'discussion.assessed',{outcome:s.outcome});
    s.report=makeReport(s);
    writeFileSync(join(this.outputDir,s.id,'report.md'),s.report,'utf8');
    this.emitEvent(s,'session.finished',{status:s.status,calls:s.calls,budget:s.budget,usage:usageSummary(s.events),spendKnownUSD:s.spendKnownUSD,spendIncomplete:s.spendIncomplete});
  }
}
