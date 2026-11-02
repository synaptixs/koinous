import {validBudgetState} from './budgets.ts';
import {validClaimAssessment} from './claims.ts';
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import type {Event,Session,AgentId} from './core.ts';
import {AGENTS} from './core.ts';
import {resolveSelection} from './selection.ts';
import {parsePosition} from './discussion-outcome.ts';

export const SESSION_ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const TERMINAL=new Set(['completed','partial','failed','cancelled']);
export type SavedSummary={id:string;prompt:string;status:string;createdAt:string;calls:number;providers?:readonly AgentId[];models?:Partial<Record<AgentId,string>>};
export function sessionSummary(s:Session):SavedSummary{return {id:s.id,prompt:s.prompt,status:s.status,createdAt:s.events[0]?.at||'',calls:s.calls,providers:s.selection?.providers??s.participants,models:s.selection?.models};}
function requireValue(value:unknown):asserts value {if(!value)throw Error('Invalid saved session');}

// Read only application records; never follow a symlink or scan inside a session directory.
export class SavedSessions {
 private root:string;
 constructor(root:string){this.root=root;}
 private read(path:string,maxBytes:number){
  const base=realpathSync(this.root),target=realpathSync(path),rel=relative(base,target);
  requireValue(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const stat=fstatSync(fd);requireValue(stat.isFile()&&stat.size<=maxBytes);return readFileSync(fd,'utf8');}finally{closeSync(fd);}
 }
 private scan(){
  const paths=new Map<string,string[]>();let visited=0,candidates=0,truncated=false;
  const walk=(dir:string,depth:number)=>{
   if(visited++>=1000){truncated=true;return;}
   let names:string[];try{names=readdirSync(dir).sort();}catch{truncated=true;return;}
   for(const name of names){
    const path=join(dir,name);let stat;try{stat=lstatSync(path);}catch{continue;}
    if(!stat.isDirectory()||stat.isSymbolicLink())continue;
    if(SESSION_ID.test(name)){if(candidates++>=500){truncated=true;break;}const matches=paths.get(name)||[];matches.push(path);paths.set(name,matches);}
    else if(depth<4)walk(path,depth+1);
    else truncated=true;
    if(visited>=1000||candidates>=500){truncated=true;break;}
   }
  };
  if(!lstatSync(this.root).isSymbolicLink())walk(this.root,0);
  return {paths,truncated};
 }
 private restore(id:string,path:string):Session {
  const raw=this.read(join(path,'events.jsonl'),8*1024*1024);
  const events:Event[]=raw.trim().split('\n').map(line=>JSON.parse(line));
  requireValue(events.length>1&&events.length<=1000);
  requireValue(events.every((e,i)=>e&&typeof e==='object'&&e.seq===i+1&&typeof e.type==='string'&&typeof e.at==='string'&&Number.isFinite(Date.parse(e.at))));
  const first=events[0],last=events.at(-1)!;
  requireValue(first.type==='session.created'&&typeof first.prompt==='string'&&first.prompt.length<=6000);
  requireValue(last.type==='session.finished'&&typeof last.status==='string'&&TERMINAL.has(last.status)&&Number.isInteger(last.calls)&&Number(last.calls)>=0&&Number(last.calls)<=9);
  requireValue(first.maxRounds===1||first.maxRounds===2||first.maxRounds===3);
  if(last.budget!==undefined)requireValue(validBudgetState(last.budget));
  const entries=events.filter(e=>e.type==='agent.completed');
  requireValue(entries.length<=9&&entries.every(e=>AGENTS.includes(e.agent as never)&&[1,2,3].includes(Number(e.round))&&typeof e.text==='string'));
  requireValue(new Set(entries.map(e=>`${e.agent}:${e.round}`)).size===entries.length);
  const assessed=events.find(e=>e.type==='discussion.assessed');
  if(assessed){
   const o=assessed.outcome as Session['outcome'];
   requireValue(o&&['agreement','direction-alignment','majority-direction','split','insufficient'].includes(o.status));
   requireValue(typeof o.recommendation==='string'&&typeof o.caveat==='string'&&o.coverage&&Number.isInteger(o.coverage.valid)&&Number.isInteger(o.coverage.expected));
   requireValue(Array.isArray(o.positions)&&o.positions.every(p=>p&&AGENTS.includes(p.agent)&&parsePosition(JSON.stringify(p.position))));
   if(o.claimAssessment!==undefined)requireValue(validClaimAssessment(o.claimAssessment));
   requireValue(Array.isArray(o.supporters)&&o.supporters.every(a=>AGENTS.includes(a)));
   requireValue(Array.isArray(o.nextSteps)&&o.nextSteps.every(x=>typeof x==='string'));
   requireValue(Array.isArray(o.unresolved)&&o.unresolved.every(x=>x&&AGENTS.includes(x.agent)&&typeof x.text==='string'));
  }
  const configured=events.find(e=>e.type==='participants.configured');
  if(configured?.agents)requireValue(Array.isArray(configured.agents)&&configured.agents.length<=3&&configured.agents.every(a=>AGENTS.includes(a))&&new Set(configured.agents).size===configured.agents.length);
  if(configured?.selection)resolveSelection(configured.selection,configured.selection as NonNullable<Session['selection']>);
  requireValue(entries.length<=Number(last.calls));
  const grounding=events.find(e=>e.type==='grounding.pinned');
  // Preserve recorded outcomes and reports. Do not reassess old runs with newer algorithms.
  return {id,budget:last.budget as Session['budget'],prompt:first.prompt as string,context:typeof first.context==='string'?first.context:'',grounding:grounding?'configured':'none',
   maxRounds:first.maxRounds as number,status:last.status as string,calls:Number(last.calls),
   spendKnownUSD:typeof last.spendKnownUSD==='number'?last.spendKnownUSD:0,spendIncomplete:last.spendIncomplete!==false,
   participants:configured?.agents as Session['participants'],selection:configured?.selection as Session['selection'],
   events,entries:entries as unknown as Session['entries'],interventions:[],cancel:new AbortController(),
   outcome:assessed?.outcome as Session['outcome'],report:this.read(join(path,'report.md'),2*1024*1024),
   ...(grounding?{evidence:{snapshotId:String(grounding.snapshotId),hash:String(grounding.sha256),items:[],source:'file' as const}}:{})};
 }
 load(id:string):Session|undefined {
  if(!SESSION_ID.test(id))return;
  const matches=this.scan().paths.get(id);
  if(matches?.length!==1)return;
  try{return this.restore(id,matches[0]);}catch{return;}
 }
 list(){
  const {paths,truncated}=this.scan();const sessions:SavedSummary[]=[];let unavailable=0;
  for(const [id,matches] of paths){
   if(matches.length!==1){unavailable++;continue;}
   try{sessions.push(sessionSummary(this.restore(id,matches[0])));}catch{unavailable++;}
  }
  return {sessions,unavailable,truncated};
 }
}
