import {ResponseValidator} from './response-validation.ts';
import type {ValidationIssue} from './response-validation.ts';
import {parsePeerResponses} from './discussion-workflow.ts';
import type {PeerResponse} from './discussion-workflow.ts';
import {parseClaims,assessClaims,CLAIM_SCOPE} from './claims.ts';
import type {Claim,ClaimAssessment} from './claims.ts';
import type {AgentId,Session} from './core.ts';
export const DIRECTIONS=['proceed','revise','pilot','defer','reject'] as const;
export type Position={revisions?:PeerResponse[];claims?:Claim[];direction:typeof DIRECTIONS[number];recommendation:string;rationale:string;risks:string[];disagreements:string[];nextSteps:string[]};
export type Outcome={claimAssessment?:ClaimAssessment;status:'agreement'|'direction-alignment'|'majority-direction'|'split'|'insufficient';coverage:{valid:number;expected:number};positions:Array<{agent:AgentId;position:Position}>;missing:AgentId[];invalid:AgentId[];direction:Position['direction']|null;recommendation:string;proposalBy:AgentId|null;supporters:AgentId[];unresolved:Array<{agent:AgentId;text:string}>;nextSteps:string[];caveat:string};
export const FINAL_POSITION_INSTRUCTIONS=`Return only a JSON object (no prose) with exactly these keys:
{"revisions":[{"peer":"provider ID","decision":"adopted|rejected|unresolved","reason":"how this peer critique changed your view, or why it did not"}],"direction":"proceed|revise|pilot|defer|reject","recommendation":"one concrete recommended course of action","rationale":"why, with assumptions identified","risks":["remaining risk"],"disagreements":["specific unresolved disagreement, or empty array"],"nextSteps":["concrete next action"],"claims":[{"id":"c1","kind":"fact|assumption|proposal","text":"one material claim","evidenceIds":[],"snapshotId":null}]}.
Include one revisions entry for each peer whose critique you received, never yourself; at most two entries, each reason at most 400 characters. Explain concrete changes or why you retain your position. Next steps should include an owner or role, an observable success criterion and a stop/revisit condition. Include all material factual premises as claims; do not hide them in rationale. Use kind fact for factual assertions, assumption for unverified premises, proposal for suggested actions. Cite only supplied evidence IDs and their exact snapshotId; otherwise use [] and null. Up to eight claims, each text at most 600 characters, ID 1–40 letters/digits/underscore/hyphen, up to five evidence IDs of 200 characters, snapshotId at most 200 characters. Use claims: [] only when there are no material claims. Choose one direction value. Limit the complete response to 12000 characters. Limit recommendation and rationale to 1200 characters each; risks, disagreements and nextSteps to five strings of 400 characters each. Do not claim other providers endorse your wording. Preserve uncertainty and disagreement; agreement is not a correctness guarantee.`;
export function parsePosition(text:string,issues:ValidationIssue[]=[]):Position|null {
 const v=new ResponseValidator(issues),p=v.json(text,12000);
 const required=['direction','recommendation','rationale','risks','disagreements','nextSteps'];
 if(!v.valid||!v.record(p,'response',required,['claims','revisions']))return null;
 v.choice(p.direction,'direction',DIRECTIONS);
 for(const key of ['recommendation','rationale'])v.text(p[key],key,1200);
 for(const key of ['risks','disagreements','nextSteps'])v.strings(p[key],key,5,400);
 if(Array.isArray(p.nextSteps)&&!p.nextSteps.length)v.issue('nextSteps','invalid_value','nextSteps: at least one next action is required.');
 const claims=Object.hasOwn(p,'claims')?parseClaims(p.claims,issues):undefined;
 const revisions=Object.hasOwn(p,'revisions')?parsePeerResponses(p.revisions,issues,'revisions'):undefined;
 if(!v.valid||claims===null||revisions===null)return null;
 return {...(revisions!==undefined?{revisions}:{}),...(claims!==undefined?{claims}:{}),direction:p.direction,recommendation:p.recommendation.trim(),rationale:p.rationale.trim(),risks:p.risks.map((x:string)=>x.trim()),disagreements:p.disagreements.map((x:string)=>x.trim()),nextSteps:p.nextSteps.map((x:string)=>x.trim())};
}
const normalized=(s:string)=>s.trim().replace(/\s+/g,' ').toLowerCase();
export function assessDiscussion(s:Session):Outcome{
 const roster=[...new Set(s.participants??s.selection?.providers??[])];
 const positions:Outcome['positions']=[],missing:AgentId[]=[],invalid:AgentId[]=[];
 for(const agent of roster){
  const entries=s.entries.filter(e=>e.agent===agent&&e.round===3);
  if(!entries.length){missing.push(agent);continue;}
  // The response text is authoritative; never trust a cached parsed object as a vote.
  const position=entries.length===1?parsePosition(entries[0].text):null;
  if(position)positions.push({agent,position});else invalid.push(agent);
 }
 const unresolved:Outcome['unresolved']=positions.flatMap(({agent,position})=>position.disagreements.map(text=>({agent,text})));
 for(const agent of missing)unresolved.push({agent,text:'Final-round response missing; agreement cannot be assumed.'});
 for(const agent of invalid)unresolved.push({agent,text:'Final position could not be validated; inspect the original response.'});
 const claimAssessment:ClaimAssessment={version:1,declaredBy:positions.filter(p=>p.position.claims!==undefined).map(p=>p.agent),unassessed:roster.filter(a=>!positions.some(p=>p.agent===a&&p.position.claims!==undefined)),checks:positions.flatMap(p=>assessClaims(p.agent,p.position.claims??[],s.evidence)),scope:CLAIM_SCOPE};
 for(const agent of claimAssessment.unassessed)unresolved.push({agent,text:'Claim coverage unassessed: no valid structured claim declaration.'});
 for(const c of claimAssessment.checks)if(c.status!=='proposal')unresolved.push({agent:c.agent,text:`Claim ${c.claim.id} (${c.status}): ${c.claim.text} ${c.issues.join(' ')}`});
 // Matching a recommendation does not settle different rationale, risks or next steps.
 if(positions.length>1){
  const signature=(p:Position)=>JSON.stringify([normalized(p.rationale),p.risks.map(normalized).sort(),p.nextSteps.map(normalized).sort(),(p.claims??[]).filter(c=>c.kind==='proposal').map(c=>normalized(c.text)).sort()]);
  if(new Set(positions.map(p=>signature(p.position))).size>1)for(const {agent,position} of positions)unresolved.push({agent,text:`Rationale, risk, next-step or proposal differences remain unreviewed. Rationale: ${position.rationale} Risks: ${position.risks.join('; ')} Next steps: ${position.nextSteps.join('; ')}`});
 }
 const counts=DIRECTIONS.map(direction=>({direction,count:positions.filter(p=>p.position.direction===direction).length})).sort((a,b)=>b.count-a.count);
 const leader=counts[0];const majority=leader.count>roster.length/2&&positions.length>=2;
 const supporters=majority?positions.filter(p=>p.position.direction===leader.direction).map(p=>p.agent):[];
 const proposal=majority?positions.find(p=>p.position.direction===leader.direction):undefined;
 const complete=roster.length>=2&&positions.length===roster.length;
 const aligned=complete&&leader.count===roster.length;
 const identical=aligned&&new Set(positions.map(p=>normalized(p.position.recommendation))).size===1;
 const status:Outcome['status']=positions.length<2?'insufficient':identical&&!unresolved.length&&s.status==='completed'?'agreement':aligned?'direction-alignment':majority?'majority-direction':'split';
 for(const p of positions){
  if(majority&&p.position.direction!==leader.direction)unresolved.push({agent:p.agent,text:`Alternative direction: ${p.position.direction}. ${p.position.recommendation}`});
  else if(!identical)unresolved.push({agent:p.agent,text:`Provider proposal (not jointly endorsed): ${p.position.recommendation}`});
 }
 if(s.status!=='completed')unresolved.push(...positions.map(p=>({agent:p.agent,text:`Session ended as ${s.status}; recommendation is provisional.`})));
 return {claimAssessment,status,coverage:{valid:positions.length,expected:roster.length},positions,missing,invalid,direction:majority?leader.direction:null,
 recommendation:proposal?proposal.position.recommendation:'Defer commitment: compare the remaining proposals in a small reversible experiment, define success criteria, and resolve the missing or conflicting final positions.',
 proposalBy:proposal?.agent??null,supporters,unresolved,
 nextSteps:proposal?proposal.position.nextSteps:['Identify the unresolved decision and missing information.','Agree on success criteria before choosing a course of action.'],
 caveat:'Agreement is measured from declared directions and matching recommendation wording, not inferred semantic consensus or verified correctness. For differing wording, the representative proposal is the first supporting provider in the selected roster; others have not endorsed it. Missing replies, unverified claims, assumptions and dissent remain visible. Only declared claims are checked; omitted claims and free prose are not exhaustively fact-checked.'};
}
const safe=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[\r\n]+/g,' ');
export function outcomeMarkdown(o:Outcome):string[]{
 const lines=['## Final recommendation','',safe(o.recommendation),'',`**Assessment:** ${o.status}. **Validated final positions:** ${o.coverage.valid}/${o.coverage.expected}.`,
 o.proposalBy?`Proposal by ${o.proposalBy}; direction ${o.direction} supported by ${o.supporters.join(', ')}. Wording is jointly matched only when assessment is agreement.`:'No majority recommendation established; the recommendation above is a procedural fallback.', '',safe(o.caveat),'','### Next actions','',...o.nextSteps.map((x,i)=>`${i+1}. ${safe(x)}`),'','### Provider reasoning',''];
 for(const {agent,position} of o.positions){
  lines.push(`#### ${agent} — Why this approach`,'',safe(position.rationale),'','**Provider proposal:** '+safe(position.recommendation),'',`**Declared direction:** ${position.direction}`,'','**Risks and tradeoffs**','',...(position.risks.length?position.risks.map(r=>`- ${safe(r)}`):['No risks declared.']),'','**Provider next actions**','',...position.nextSteps.map((x,i)=>`${i+1}. ${safe(x)}`),'');
 }
 lines.push('### Unresolved disagreements','');
 const dissent=o.positions.flatMap(({agent,position})=>position.disagreements.map(text=>({agent,text})));
 if(dissent.length)lines.push(...dissent.map(x=>`- **${x.agent}:** ${safe(x.text)}`));
 else lines.push('No unresolved disagreement was declared in the validated final positions. This does not prove correctness.');
 lines.push('','### All unresolved disagreements and gaps','');
 if(o.unresolved.length)lines.push(...o.unresolved.map(x=>`- **${x.agent}:** ${safe(x.text)}`));
 else lines.push('None recorded; this does not prove correctness.');
 lines.push('','### Claims and support checks','');
 if(o.claimAssessment){
  lines.push(o.claimAssessment.scope,`Structured declarations: ${o.claimAssessment.declaredBy.length}/${o.coverage.expected}. Unassessed: ${o.claimAssessment.unassessed.join(', ')||'none'}.`);
  for(const c of o.claimAssessment.checks)lines.push(`- ${c.agent}/${safe(c.claim.id)} — ${c.status}: ${safe(c.claim.text)} References: ${c.claim.evidenceIds.map(safe).join(', ')||'none'}; snapshot: ${safe(c.claim.snapshotId??'none')}. ${c.issues.map(safe).join(' ')}`);
  if(!o.claimAssessment.checks.length)lines.push('No structured claims declared; this is not proof that the response contains no factual assertions.');
 }else lines.push('Claim assessment was not recorded for this saved discussion; support is unassessed.');
 lines.push('');return lines;
}
