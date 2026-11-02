import {ResponseValidator} from './response-validation.ts';
import type {ValidationIssue} from './response-validation.ts';
import type {AgentId, Evidence} from './core.ts';

export type Claim = {id:string;kind:'fact'|'assumption'|'proposal';text:string;evidenceIds:string[];snapshotId:string|null};
export type ClaimCheck = {agent:AgentId;claim:Claim;status:'unsupported'|'reference-valid-unverified'|'assumption'|'proposal';issues:string[]};
export type ClaimAssessment = {version:1;declaredBy:AgentId[];unassessed:AgentId[];checks:ClaimCheck[];scope:string};
export const CLAIM_SCOPE='Only declared final-round claims are checked. Free prose, omitted claims and earlier rounds are not exhaustively extracted or fact-checked. Resolved references establish availability, not entailment or truth; user context and peer agreement are not independent evidence.';

export function parseClaims(value:unknown,issues:ValidationIssue[]=[]):Claim[]|null {
 const v=new ResponseValidator(issues);
 if(!v.array(value,'claims',8))return null;
 const ids=new Set<string>();
 for(const [i,c] of value.entries()){
  const at=`claims[${i}]`;
  if(!v.record(c,at,['id','kind','text','evidenceIds','snapshotId']))continue;
  v.text(c.id,at+'.id',40);
  if(typeof c.id==='string'&&!/^[a-zA-Z0-9_-]{1,40}$/.test(c.id))v.issue(at+'.id','invalid_value',`${at}.id: use 1–40 letters, digits, underscores or hyphens.`);
  if(ids.has(c.id))v.issue(at+'.id','duplicate',`${at}.id: duplicate claim ID.`);
  ids.add(c.id);
  v.choice(c.kind,at+'.kind',['fact','assumption','proposal']);
  v.text(c.text,at+'.text',600);
  v.strings(c.evidenceIds,at+'.evidenceIds',5,200);
  if(Array.isArray(c.evidenceIds)&&new Set(c.evidenceIds).size!==c.evidenceIds.length)v.issue(at+'.evidenceIds','duplicate',`${at}.evidenceIds: duplicate reference.`);
  if(c.snapshotId!==null)v.text(c.snapshotId,at+'.snapshotId',200);
 }
 if(!v.valid)return null;
 return value.map(c=>({id:c.id,kind:c.kind,text:c.text.trim(),evidenceIds:[...c.evidenceIds],snapshotId:c.snapshotId}));
}

export function assessClaims(agent:AgentId,claims:Claim[],evidence?:Evidence):ClaimCheck[]{
 return claims.map(claim=>{
  const issues:string[]=[];
  if(claim.kind==='fact'&&!claim.evidenceIds.length)issues.push('Unsupported factual claim: no evidence references supplied.');
  if(claim.evidenceIds.length){
   if(!evidence)issues.push('No evidence snapshot supplied; references cannot resolve.');
   else {
    if(claim.snapshotId!==evidence.snapshotId)issues.push('Missing or mismatched snapshot revision.');
    for(const id of claim.evidenceIds){
     const matches=evidence.items.filter(item=>item.id===id);
     if(matches.length!==1)issues.push(`Evidence ID ${id}: ${matches.length?'ambiguous':'not found in supplied snapshot'}.`);
    }
   }
  }else if(claim.snapshotId!==null)issues.push('Snapshot declared without evidence references.');
  if(claim.kind!=='fact'&&claim.evidenceIds.length)issues.push('References do not turn an assumption or proposal into an established fact.');
  const status:ClaimCheck['status']=issues.length?'unsupported':claim.kind==='fact'?'reference-valid-unverified':claim.kind;
  if(status==='reference-valid-unverified')issues.push('References resolve, but factual support and truth require independent review.');
  if(status==='assumption')issues.push('Declared assumption; not independently verified.');
  return {agent,claim,status,issues};
 });
}

// Read-only history validates the stored assessment shape; it never re-certifies old claims.
export function validClaimAssessment(value:unknown):value is ClaimAssessment {
 if(!value||typeof value!=='object')return false;
 const a=value as ClaimAssessment;
 const roster=(v:unknown):v is AgentId[]=>Array.isArray(v)&&v.length<=3&&new Set(v).size===v.length&&v.every(x=>['codex','claude','grok'].includes(x));
 if(a.version!==1||typeof a.scope!=='string'||!a.scope.trim()||a.scope.length>1000||!roster(a.declaredBy)||!roster(a.unassessed)||a.declaredBy.some(x=>a.unassessed.includes(x))||!Array.isArray(a.checks)||a.checks.length>24)return false;
 const ids=new Set<string>();
 return a.checks.every(c=>{
  if(!c||!a.declaredBy.includes(c.agent)||!parseClaims([c.claim])||!['unsupported','reference-valid-unverified','assumption','proposal'].includes(c.status)||!Array.isArray(c.issues)||c.issues.length>10||c.issues.some(x=>typeof x!=='string'||x.length>1000))return false;
  const id=c.agent+':'+c.claim.id;if(ids.has(id))return false;ids.add(id);return true;
 });
}
