// Offline-first evaluation, separate from the product's two-participant contract.
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {composePrompt} from './core.ts';
import type {Adapter,Session,Event} from './core.ts';
import type {Selection} from './selection.ts';
import {resolveSelection} from './selection.ts';
import {Engine} from './engine.ts';
import {withDeadline,ProviderFailure,usageSummary} from './provider-runtime.ts';
import {responseValidation,workflowAssessment} from './discussion-workflow.ts';
import {parsePosition} from './discussion-outcome.ts';
export type EvalTask={id:string;split:'development'|'heldout';question:string;context:string;checks:string[]};
export const ARMS=['single-a','single-b','independent-2','independent-6','discussion'] as const;
export type Arm=typeof ARMS[number];
export const CALLS:Record<Arm,number>={'single-a':1,'single-b':1,'independent-2':2,'independent-6':6,discussion:6};
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function validateTasks(value:unknown):EvalTask[]{
 if(!Array.isArray(value)||value.length!==6)throw Error('Protocol requires exactly six tasks');
 const ids=new Set<string>();
 for(const t of value){
  if(!t||!/^((dev)|(holdout))-[a-z]+$/.test(t.id)||ids.has(t.id)||!['development','heldout'].includes(t.split)||typeof t.question!=='string'||!t.question.trim()||t.question.length>6000||typeof t.context!=='string'||t.context.length>6000||!Array.isArray(t.checks)||t.checks.length!==3||t.checks.some((x:unknown)=>typeof x!=='string'||!x.trim()))throw Error('Invalid evaluation task');
  ids.add(t.id);
 }
 if(value.filter(t=>t.split==='development').length!==2||value.filter(t=>t.split==='heldout').length!==4)throw Error('Expected two development and four heldout tasks');
 return value;
}
export function evaluationSelection(value:unknown):Selection{
 const s=resolveSelection(value,value as Selection);
 if(s.providers.length!==2||s.providers[0]!=='codex'||!['codex-2','claude'].includes(s.providers[1])||s.providers.some(id=>!s.models[id]))throw Error('Select explicit models for codex + codex-2 or codex + claude');
 return s;
}
export function evaluationSession(task:EvalTask,selection:Selection):Session{
 return {id:task.id,prompt:task.question,context:task.context,grounding:'none',selection,participants:[...selection.providers],maxRounds:3,status:'created',events:[],entries:[],interventions:[],calls:0,spendKnownUSD:0,spendIncomplete:false,cancel:new AbortController()};
}
export function baselinePrompt(task:EvalTask,selection:Selection,id:Adapter['id']):string{
 // Same question/context, final-position schema and word target; no peer or prior answer.
 return composePrompt(evaluationSession(task,selection),id,3,'Keep the response under about 450 words. This is a standalone baseline: evaluate alternatives independently; no prior analysis or peer critique was supplied.');
}
export type EvaluationResult={task:string;split:EvalTask['split'];arm:Arm;status:string;calls:number;plannedCalls:number;durationMs:number;events:Event[];outputs:{agent:string;text:string}[];validFinals:number;expectedFinals:number;peerCoverage:boolean|null;sessionId?:string};
export type Factory=(selection:Selection)=>Adapter[];
export async function executeCell(task:EvalTask,selection:Selection,arm:Arm,root:string,factory:Factory,signal:AbortSignal,timeoutMs=120000):Promise<EvaluationResult>{
 if(!ARMS.includes(arm)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('Invalid arm/deadline');
 const dir=join(root,`${task.id}-${arm}`);mkdirSync(dir); // Never overwrite or silently resume.
 const start=performance.now();
 if(arm==='discussion'){
  const engine=new Engine(()=>factory(selection),dir);
  const s=engine.create(task.question,3,selection,{context:task.context,grounding:'none',budget:{maxCalls:6,maxTokens:null}});
  const cancel=()=>engine.cancel(s);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  try{await engine.run(s);}finally{signal.removeEventListener('abort',cancel);}
  const finals=s.entries.filter(e=>e.round===3);
  const result:EvaluationResult={task:task.id,split:task.split,arm,status:s.status,calls:s.calls,plannedCalls:6,durationMs:Math.round(performance.now()-start),events:s.events,outputs:finals.map(e=>({agent:e.agent,text:e.text})),validFinals:finals.filter(e=>parsePosition(e.text)).length,expectedFinals:2,peerCoverage:workflowAssessment(s).complete,sessionId:s.id};
  writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
 }
 const s=evaluationSession(task,selection);s.status='running';
 const emit=(type:string,data:Record<string,unknown>={})=>{const e={seq:s.events.length+1,at:new Date().toISOString(),type,...data};s.events.push(e);appendFileSync(join(dir,'events.jsonl'),JSON.stringify(e)+'\n');};
 const indices=arm==='single-a'?[0]:arm==='single-b'?[1]:arm==='independent-2'?[0,1]:[0,1,0,1,0,1];
 emit('evaluation.started',{task:task.id,arm});
 // Independent answers are sequential and fresh. The latency tradeoff is explicit.
 for(const index of indices){
  if(signal.aborted){s.status='cancelled';break;}
  const adapters=factory(selection),adapter=adapters[index];
  if(adapters.length!==2||adapters.some((a,i)=>a.id!==selection.providers[i]))throw Error('Evaluation factory roster mismatch');
  const prompt=baselinePrompt(task,selection,adapter.id);emit('prompt.recorded',{agent:adapter.id,prompt,sha256:hash(prompt)});
  const began=performance.now();let attempted=false;
  try{
   if(adapter.prepare)await withDeadline(sig=>adapter.prepare!(sig),signal,timeoutMs);
   s.calls++;attempted=true;emit('agent.started',{agent:adapter.id,round:3});
   const reply=await withDeadline(sig=>adapter.run(prompt,3,sig),signal,timeoutMs);
   s.entries.push({...reply,agent:adapter.id,round:3});
   emit('agent.completed',{agent:adapter.id,round:3,...reply,durationMs:Math.round(performance.now()-began),validation:responseValidation({round:3,text:reply.text})});
  }catch(error){
   const e=error instanceof ProviderFailure?error:new ProviderFailure('provider_error','Evaluation provider failed');
   emit(attempted?'agent.error':'runtime.error',{agent:adapter.id,round:3,...e.details,code:e.code,durationMs:Math.round(performance.now()-began)});s.status=signal.aborted?'cancelled':'failed';
  }finally{
   for(const a of adapters.slice().reverse())if(a.dispose)try{await a.dispose();emit('runtime.cleaned',{agent:a.id});}catch{emit('cleanup.failed',{agent:a.id});s.status='failed';}
  }
  if(s.status!=='running')break;
 }
 if(s.status==='running')s.status='completed';
 emit('evaluation.finished',{status:s.status,calls:s.calls});
 const result:EvaluationResult={task:task.id,split:task.split,arm,status:s.status,calls:s.calls,plannedCalls:CALLS[arm],durationMs:Math.round(performance.now()-start),events:s.events,outputs:s.entries.map(e=>({agent:e.agent,text:e.text})),validFinals:s.entries.filter(e=>parsePosition(e.text)).length,expectedFinals:CALLS[arm],peerCoverage:null};
 writeFileSync(join(dir,'result.json'),JSON.stringify(result,null,2),{flag:'wx'});return result;
}
export function observability(results:EvaluationResult[]){
 const percentile=(values:number[],p:number)=>{const sorted=values.slice().sort((a,b)=>a-b);return sorted.length?sorted[Math.ceil(p*sorted.length)-1]:null;};
 return ARMS.map(arm=>{const rows=results.filter(r=>r.arm===arm),events=rows.flatMap(r=>r.events);return {arm,samples:rows.length,completed:rows.filter(r=>r.status==='completed').length,failed:rows.filter(r=>r.status!=='completed').length,calls:rows.reduce((n,r)=>n+r.calls,0),plannedCalls:rows.reduce((n,r)=>n+r.plannedCalls,0),validFinals:rows.reduce((n,r)=>n+r.validFinals,0),expectedFinals:rows.reduce((n,r)=>n+r.expectedFinals,0),callP50Ms:percentile(events.filter(e=>e.type==='agent.completed'||e.type==='agent.error').map(e=>Number(e.durationMs)).filter(Number.isFinite),.5),callP95Ms:percentile(events.filter(e=>e.type==='agent.completed'||e.type==='agent.error').map(e=>Number(e.durationMs)).filter(Number.isFinite),.95),warnings:events.filter(e=>e.type==='agent.completed'&&(e.validation as {status?:string}|undefined)?.status==='warning').length,peerComplete:arm==='discussion'?rows.filter(r=>r.peerCoverage).length:null,p50Ms:percentile(rows.map(r=>r.durationMs),.5),p95Ms:percentile(rows.map(r=>r.durationMs),.95),usage:usageSummary(events),timeouts:events.filter(e=>e.code==='timeout').length,cleanupErrors:events.filter(e=>e.type==='cleanup.failed'||e.type==='session.error'&&String(e.error).includes('cleanup')).length};});
}
export type BlindPacket={id:string;task:string;question:string;context:string;answers:string[];checks:string[]};
export function blindPackets(results:EvaluationResult[],tasks:EvalTask[],salt:string){
 const key:Record<string,{task:string;arm:Arm}>={};
 const packets=results.map(r=>{const id=hash(salt+':'+r.task+':'+r.arm).slice(0,16),task=tasks.find(t=>t.id===r.task)!;key[id]={task:r.task,arm:r.arm};return {id,task:r.task,question:task.question,context:task.context,checks:task.checks,answers:(r.outputs.length?r.outputs:[{text:'',agent:''}]).map(o=>{const p=parsePosition(o.text);return p?JSON.stringify({recommendation:p.recommendation,rationale:p.rationale,risks:p.risks,disagreements:p.disagreements,nextSteps:p.nextSteps,claims:p.claims}):'[No usable final position]';})};}).sort((a,b)=>a.id.localeCompare(b.id));
 return {packets,key};
}
export type Grade={id:string;reviewer:string;correctness:number;alternatives:number;actionability:number;uncertainty:number;notes:string};
export function gradeReport(packets:BlindPacket[],grades:Grade[],key:Record<string,{task:string;arm:Arm}>,synthetic:boolean,expectedTasks:string[]=[...new Set(Object.values(key).map(v=>v.task))]){
 const seen=new Set<string>();
 for(const g of grades){const identity=g.id+':'+g.reviewer;if(!packets.some(p=>p.id===g.id)||!g.reviewer?.trim()||!g.notes?.trim()||seen.has(identity)||[g.correctness,g.alternatives,g.actionability,g.uncertainty].some(v=>!Number.isInteger(v)||v<0||v>4))throw Error('Invalid, duplicate or unreasoned human grade');seen.add(identity);}
 const scores=packets.map(p=>{const gs=grades.filter(g=>g.id===p.id);return {id:p.id,...key[p.id],reviewers:gs.length,correctness:gs.length?gs.reduce((n,g)=>n+g.correctness,0)/gs.length:null,reviewerRange:gs.length?Math.max(...gs.map(g=>(g.correctness+g.alternatives+g.actionability+g.uncertainty)/4))-Math.min(...gs.map(g=>(g.correctness+g.alternatives+g.actionability+g.uncertainty)/4)):null,mean:gs.length?gs.reduce((n,g)=>n+(g.correctness+g.alternatives+g.actionability+g.uncertainty)/4,0)/gs.length:null};});
 const deltas=tasksForScores(scores).map(task=>{const rows=scores.filter(s=>s.task===task),discussion=rows.find(r=>r.arm==='discussion');const baselines=rows.filter(r=>r.arm==='single-a'||r.arm==='single-b');return {task,delta:discussion?.mean!=null&&baselines.length===2&&baselines.every(r=>r.mean!=null)?discussion.mean-Math.max(...baselines.map(r=>r.mean!)):null};});
 const complete=expectedTasks.length>0&&expectedTasks.every(task=>ARMS.every(arm=>scores.filter(s=>s.task===task&&s.arm===arm&&s.reviewers===2).length===1));
 const comparisons=ARMS.filter(a=>a!=='discussion').map(arm=>{const paired=expectedTasks.map(task=>{const d=scores.find(s=>s.task===task&&s.arm==='discussion'),b=scores.find(s=>s.task===task&&s.arm===arm);return d?.mean!=null&&b?.mean!=null?d.mean-b.mean:null;});const known=paired.filter((v):v is number=>v!==null);return {arm,paired,completePairs:known.length,expectedPairs:expectedTasks.length,mean:known.length?known.reduce((a,b)=>a+b,0)/known.length:null,range:known.length?[Math.min(...known),Math.max(...known)]:null};});
 return {synthetic,scored:grades.length,expectedPackets:expectedTasks.length*ARMS.length,complete,scores,deltas,comparisons,conclusion:synthetic?'Synthetic plumbing only; no empirical conclusion.':'Descriptive pilot only. Report all paired deltas, failures and missing grades; four heldout tasks cannot establish general superiority.'};
}
function tasksForScores(scores:{task:string}[]){return [...new Set(scores.map(s=>s.task))].sort();}
export function dashboardHtml(results:EvaluationResult[],synthetic:boolean,plannedCells?:number):string{
 const metrics=observability(results);
 const rows=metrics.map(m=>`<tr><td>${m.arm}</td><td>${m.completed}/${m.samples}</td><td>${m.failed}</td><td>${m.calls}/${m.plannedCalls}</td><td>${m.validFinals}/${m.expectedFinals}</td><td>${m.peerComplete??'n/a'}</td><td>${m.p50Ms??'unknown'} / ${m.p95Ms??'unknown'}</td><td>${m.usage.inputTokens.known} (${m.usage.inputTokens.missingCalls} missing)</td><td>${m.usage.outputTokens.known} (${m.usage.outputTokens.missingCalls} missing)</td><td>${m.usage.usd.known} (${m.usage.usd.missingCalls} missing)</td></tr>`).join('');
 const data=JSON.stringify(metrics,null,2).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 return `<!doctype html><meta charset="utf-8"><title>Riff evaluation observability</title><style>body{font:16px system-ui;max-width:1100px;margin:3rem auto;padding:1rem;background:#101827;color:#e5eaf2}pre{white-space:pre-wrap;background:#1c293d;padding:1rem}h1{color:#7dd3fc}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;border-bottom:1px solid #475569;text-align:left}.scroll{overflow:auto}</style><h1>Evaluation observability</h1><p>Recorded cells: ${results.length} / ${plannedCells??'unknown planned total'}. Missing cells are not successful or free.</p><p>${synthetic?'SYNTHETIC — no model inference or quality evidence.':'Empirical observations — no automatic quality verdict.'}</p><p>Proposed SLOs: ≥95% completion; ≥95% usable final positions; 100% declared peer coverage in completed discussions; p95 discussion ≤360,000 ms. These are proposed, not accepted reliability guarantees. Small samples cannot certify SLOs.</p><p>Usage sums are lower bounds where missingCalls &gt; 0. Unknown USD is not zero or a subscription invoice. SDK hidden work is outside application call bounds. Independent arms execute sequentially; discussion participants execute concurrently. No fair latency equality is assumed.</p><div class="scroll"><table><thead><tr><th>Arm</th><th>Completed / N</th><th>Failed</th><th>Calls / planned</th><th>Valid / expected finals</th><th>Peer complete</th><th>Wall p50 / p95 ms</th><th>Input tokens</th><th>Output tokens</th><th>Known USD</th></tr></thead><tbody>${rows}</tbody></table></div><details><summary>All counters and missing usage</summary><pre>${data}</pre></details>`;
}
