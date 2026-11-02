import {providerFor} from './participants.ts';
import {AGENTS} from './core.ts';
import type {AgentId} from './core.ts';
import type {SavedSummary} from './saved-sessions.ts';

export function historyQuery(params:URLSearchParams){
 const q=(params.get('q')??'').trim();
 if(q.length>200)throw Error('Search must be at most 200 characters');
 const provider=(params.get('provider')??'').trim(),model=(params.get('model')??'').trim();
 if(provider&&!AGENTS.includes(provider as AgentId))throw Error('Choose a supported provider');
 if(model&&(model.length>128||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(model)))throw Error('Invalid requested model ID');
 const date=(key:string)=>{
  const value=params.get(key)??'';if(!value)return '';
  const ms=Date.parse(value+'T00:00:00.000Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10)!==value)throw Error('Invalid '+key+' date; use YYYY-MM-DD');
  return value;
 };
 const from=date('from'),to=date('to');if(from&&to&&from>to)throw Error('From date must not be after To date');
 const integer=(key:string,fallback:number,max:number)=>{
  const raw=params.get(key);if(raw===null)return fallback;
  if(!/^[1-9][0-9]*$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)>max)throw Error(`Invalid ${key}`);
  return Number(raw);
 };
 return {...(provider?{provider:provider as AgentId}:{}),...(model?{model}:{}),...(from?{from}:{}),...(to?{to}:{}),q,page:integer('page',1,1_000_000),pageSize:integer('pageSize',50,50)};
}
export function historyPage(summaries:SavedSummary[],query:ReturnType<typeof historyQuery>,unavailable:number,scanTruncated:boolean){
 const needle=query.q.normalize('NFKC').toLowerCase();
 const matches=summaries.filter(s=>{
  if(query.provider&&!s.providers?.some(id=>providerFor(id)===query.provider))return false;
  if(query.model){
   const models=query.provider?(s.providers??[]).filter(id=>providerFor(id)===query.provider).map(id=>s.models?.[id]):Object.values(s.models??{});
   if(!models.includes(query.model))return false;
  }
  const time=Date.parse(s.createdAt);
  if(query.from&&(!Number.isFinite(time)||time<Date.parse(query.from+'T00:00:00.000Z')))return false;
  if(query.to&&(!Number.isFinite(time)||time>=Date.parse(query.to+'T00:00:00.000Z')+86400000))return false;
  return true;
 }).filter(s=>[s.prompt,s.id,s.status].some(text=>text.normalize('NFKC').toLowerCase().includes(needle)))
  .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||a.id.localeCompare(b.id));
 const total=matches.length,totalPages=Math.max(1,Math.ceil(total/query.pageSize)),page=Math.min(query.page,totalPages);
 const offset=(page-1)*query.pageSize;
 return {sessions:matches.slice(offset,offset+query.pageSize),total,discoveredTotal:summaries.length,unavailable,
  filters:{provider:query.provider||'',model:query.model||'',from:query.from||'',to:query.to||''},q:query.q,page,pageSize:query.pageSize,totalPages,hasPrevious:page>1,hasNext:page<totalPages,
  scanTruncated,truncated:scanTruncated||total>query.pageSize};
}
