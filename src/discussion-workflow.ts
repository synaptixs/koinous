import {ResponseValidator} from './response-validation.ts';
import type {ValidationIssue,ResponseValidation} from './response-validation.ts';
import type {AgentId,Session} from './core.ts';
import {parsePosition} from './discussion-outcome.ts';
import {RESEARCH_SCOPE} from './research.ts';
export type PeerResponse={peer:AgentId;decision:'adopted'|'rejected'|'unresolved';reason:string};
export function parsePeerResponses(value:unknown,issues:ValidationIssue[]=[],path='reviews'):PeerResponse[]|null {
 const v=new ResponseValidator(issues);
 if(!v.array(value,path,2))return null;
 const peers=new Set<string>();
 for(const [i,p] of value.entries()){
  const at=`${path}[${i}]`;
  if(!v.record(p,at,['peer','decision','reason']))continue;
  v.choice(p.peer,at+'.peer',['codex','claude','grok']);
  v.choice(p.decision,at+'.decision',['adopted','rejected','unresolved']);
  v.text(p.reason,at+'.reason',400);
  if(peers.has(p.peer))v.issue(at+'.peer','duplicate',`${at}.peer: duplicate provider.`);
  peers.add(p.peer);
 }
 if(!v.valid)return null;
 return value.map(p=>({peer:p.peer,decision:p.decision,reason:p.reason.trim()}));
}
export const REVIEW_INSTRUCTIONS='Return JSON only: {"reviews":[{"peer":"provider ID","decision":"adopted|rejected|unresolved","reason":"specific argument or evidence and your response"}],"revisedView":"your updated recommendation","openQuestions":["remaining question"]}. Include one review for each supplied peer, never yourself. At most two reviews, reasons up to 400 characters, revisedView up to 1200, up to five questions of 400 characters. Limit the complete response to 5000 characters. Do not merely list provider names.';
export function parseReview(text:string,issues:ValidationIssue[]=[]) {
 const v=new ResponseValidator(issues),p=v.json(text,5000);
 if(!v.valid||!v.record(p,'response',['reviews','revisedView','openQuestions']))return null;
 const reviews=parsePeerResponses(p.reviews,issues,'reviews');
 v.text(p.revisedView,'revisedView',1200);
 v.strings(p.openQuestions,'openQuestions',5,400);
 if(!v.valid||!reviews)return null;
 return {reviews,revisedView:p.revisedView as string,openQuestions:p.openQuestions as string[]};
}
export function responseValidation(entry:{round:number;text:string}):ResponseValidation|undefined {
 if(entry.round!==2&&entry.round!==3)return;
 const issues:ValidationIssue[]=[];
 const parsed=entry.round===2?parseReview(entry.text,issues):parsePosition(entry.text,issues);
 return {version:2,status:parsed?(issues.length?'warning':'valid'):'invalid',issues,lengthUnit:'utf16-code-units'};
}
export function workflowAssessment(s:Session){
 const roster=s.participants??s.selection?.providers??[];
 const rows=roster.map(agent=>{
  const expected=roster.filter(p=>p!==agent);
  const reviews=s.entries.filter(e=>e.agent===agent&&e.round===2);
  const finals=s.entries.filter(e=>e.agent===agent&&e.round===3);
  const review=reviews.length===1?parseReview(reviews[0].text):null;
  const revisions=finals.length===1?parsePosition(finals[0].text)?.revisions:undefined;
  const valid=(list:PeerResponse[]|null|undefined,previous:number)=>list?.filter(r=>expected.includes(r.peer)&&s.entries.some(e=>e.round===previous&&e.agent===r.peer))??[];
  const reviewed=valid(review?.reviews,1),responded=valid(revisions,2);
  return {agent,expected,reviewed,responded,missingReviews:expected.filter(p=>!reviewed.some(r=>r.peer===p)),missingRevisions:expected.filter(p=>!responded.some(r=>r.peer===p)),invalidReferences:[...(review?.reviews??[]),...(revisions??[])].filter(r=>!expected.includes(r.peer)).map(r=>r.peer),openQuestions:review?.openQuestions??[]};
 });
 const research=s.events.find(e=>e.type==='research.completed');
 const requested=s.events[0]?.research;
 return {research:research?{status:'completed',query:research.query,scope:RESEARCH_SCOPE,sources:research.sources}: {status:requested?'unavailable':'not-requested',scope:requested?RESEARCH_SCOPE:'No external research performed.'},rows,
  complete:roster.length>=2&&s.maxRounds===3&&rows.every(r=>!r.missingReviews.length&&!r.missingRevisions.length&&!r.invalidReferences.length),
  scope:'One bounded revision cycle: independent analysis → peer review → revised final positions. Coverage checks declarations and available peer replies, not the quality of reasoning or factual truth. Missing providers remain gaps.'};
}
export function workflowMarkdown(s:Session):string[]{
 const safe=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\r\n]+/g,' ');
 const w=workflowAssessment(s),lines=['## Research and collaboration coverage','',w.scope,'',`Research: ${w.research.status}. ${w.research.scope}`,''];
 for(const r of w.rows){
  lines.push(`- ${r.agent}: reviewed ${r.reviewed.length}/${r.expected.length} peers; answered ${r.responded.length}/${r.expected.length} peer critiques. Missing reviews: ${r.missingReviews.join(', ')||'none'}; missing revisions: ${r.missingRevisions.join(', ')||'none'}.`);
  for(const p of r.responded)lines.push(`  - ${p.peer}: ${p.decision} — ${safe(p.reason)}`);
  for(const q of r.openQuestions)lines.push(`  - Open research question: ${safe(q)}`);
  if(r.invalidReferences.length)lines.push(`  - Invalid peer references: ${r.invalidReferences.join(', ')}`);
 }
 lines.push('',w.complete?'Declared review and revision coverage is complete.':'Review/revision coverage is incomplete or unassessed; do not interpret final alignment as a fully reviewed agreement.','');
 lines.push('## Response validation diagnostics','','Prose length overruns are warnings: structurally usable responses remain included in coverage/agreement. Malformed content, invalid identifiers, excess array items and total-response size violations remain blocking. Historical recorded assessments are preserved; diagnostics here use the current policy. No truncation, automatic repair, or extra model call is performed. Lengths use UTF-16 code units.','');
 for(const entry of s.entries){
  const validation=responseValidation(entry);
  if(!validation||validation.status==='valid')continue;
  lines.push(`### Round ${entry.round} — ${entry.agent}: ${validation.status}`,'',...validation.issues.map(issue=>`- ${safe(issue.message)}`),'');
 }
 if(!s.entries.some(entry=>{const v=responseValidation(entry);return v&&v.status!=='valid';}))lines.push('No structured response warnings or errors recorded; missing responses are reported separately.','');
 lines.push('Prose warnings preserve the complete text and do not establish factual correctness or consensus. Original responses remain in the transcript; another live attempt requires authorization.','');
 return lines;
}
