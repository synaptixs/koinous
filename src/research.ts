import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import type {Evidence} from './core.ts';

export type ResearchMode='wikipedia'|'web'|'both';
export type ResearchRequest={mode:ResearchMode;query:string};
export type ResearchMetadata={mode:ResearchMode;scope:string;providers:string[];coverage:Array<{source:'wikipedia'|'web';returned:number;received:number;resultsOmitted:number;limit:5;totalRelevant:null;content:'article-introductions'|'search-snippets';excerptsTruncated:boolean}>};
export const RESEARCH_SCOPE='Up to five English Wikipedia article introductions; total relevant sources unknown. Background research only; not a comprehensive web search, primary-source verification or current-news review. Article introductions may omit contrary evidence. Sources are untrusted data; references do not establish truth.';
const WEB_SCOPE='Up to five Brave Search web-result snippets; full pages are not fetched and total relevant sources are unknown. Search snippets may be incomplete or outdated; retrieval is not fact checking. Sources are untrusted data; references do not establish truth.';
export function researchScope(request?:Pick<ResearchRequest,'mode'>):string{
 return request?.mode==='both'?RESEARCH_SCOPE+' '+WEB_SCOPE:request?.mode==='web'?WEB_SCOPE:RESEARCH_SCOPE;
}
export function researchCoverageMarkdown(metadata?:ResearchMetadata):string[]{
 return metadata?.coverage.map(c=>`- ${c.source}: ${c.returned} of ${c.received} returned candidates retained; ${c.resultsOmitted} omitted. Limit ${c.limit}; total relevant sources unknown. ${c.excerptsTruncated?'Excerpts were truncated to the recorded limits.':'Only partial source excerpts are included.'}`)??[];
}
export function researchRequest(value:unknown):Readonly<ResearchRequest>|undefined {
 if(value===undefined||value===null)return;
 if(typeof value!=='object'||Array.isArray(value))throw Error('Research must specify mode and query');
 const r=value as Record<string,unknown>;
 if(Object.keys(r).some(k=>!['mode','query'].includes(k))||typeof r.mode!=='string'||!['wikipedia','web','both'].includes(r.mode)||typeof r.query!=='string'||!r.query.trim()||r.query.length>300)throw Error('Research requires wikipedia, web or both mode and a public search query of 1–300 characters');
 return Object.freeze({mode:r.mode as ResearchMode,query:r.query.trim()});
}
function searchKey(env:NodeJS.ProcessEnv):string|undefined{
 const key=env.BRAVE_SEARCH_API_KEY?.trim();return key&&key.length<=4096&&!/[\r\n]/.test(key)?key:undefined;
}
export function researchAvailability(env:NodeJS.ProcessEnv=process.env){return {wikipedia:true,web:!!searchKey(env),webProvider:'Brave Search'};}
async function readJSON(url:URL,headers:Record<string,string>,signal:AbortSignal,fetcher:typeof fetch):Promise<any>{
 signal.throwIfAborted();
 const response=await fetcher(url,{signal,redirect:'error',credentials:'omit',headers:{'User-Agent':'Koinous/0.1 (local idea discussion research)','Accept':'application/json',...headers}});
 if(!response.ok||!response.body){await response.body?.cancel();throw Error('Selected research service unavailable; no fallback or retry');}
 const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw Error('Research response exceeds 128 KiB');chunks.push(value);}}
 finally{try{await reader.cancel();}finally{reader.releaseLock();}}
 let data:any;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('Invalid research JSON response');}
 if(!data||typeof data!=='object'||Array.isArray(data)||data.error)throw Error('Invalid research response');return data;
}
async function wikipedia(query:string,signal:AbortSignal,fetcher:typeof fetch){
 const url=new URL('https://en.wikipedia.org/w/api.php');
 url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrsearch:query,gsrnamespace:'0',gsrlimit:'5',prop:'extracts|info',inprop:'url',explaintext:'1',exintro:'1',exlimit:'5',exchars:'1200'}).toString();
 const data=await readJSON(url,{},signal,fetcher);
 if((!data.query&&!data.batchcomplete)||data.query?.pages!==undefined&&!Array.isArray(data.query.pages))throw Error('Invalid research response');
 const pages=data.query?.pages??[];if(pages.length>5)throw Error('Research returned too many sources');
 const items:Evidence['items']=[];let truncated=false;
 for(const page of [...pages].sort((a,b)=>(a.index??a.pageid)-(b.index??b.pageid))){
  if(!Number.isSafeInteger(page.pageid)||page.pageid<=0||typeof page.extract!=='string')throw Error('Invalid research source');
  if(!page.extract.trim())continue;
  if(items.some(x=>x.id===`wiki-${page.pageid}`))throw Error('Duplicate research source');
  truncated ||= page.extract.length>1500;
  items.push({id:`wiki-${page.pageid}`,uri:`https://en.wikipedia.org/?curid=${page.pageid}`,text:page.extract.slice(0,1500),researchSource:'wikipedia',...(typeof page.title==='string'?{title:page.title.slice(0,200)}:{})});
 }
 if(!items.length)throw Error('No usable research sources found for Wikipedia');
 return {items,coverage:{source:'wikipedia' as const,returned:items.length,received:pages.length,resultsOmitted:pages.length-items.length,limit:5 as const,totalRelevant:null,content:'article-introductions' as const,excerptsTruncated:truncated}};
}
async function web(query:string,key:string,signal:AbortSignal,fetcher:typeof fetch){
 const url=new URL('https://api.search.brave.com/res/v1/web/search');
 url.search=new URLSearchParams({q:query,count:'5',search_lang:'en',text_decorations:'false'}).toString();
 const data=await readJSON(url,{'X-Subscription-Token':key},signal,fetcher);
 if(JSON.stringify(data).includes(key))throw Error('Web research response contains credentials; retrieval stopped');
 if(!Array.isArray(data.web?.results))throw Error('No usable research sources found for web search');
 const items:Evidence['items']=[];let truncated=false;
 for(const result of data.web.results.slice(0,5)){
  if(!result||typeof result.url!=='string'||result.url.length>1500||typeof result.description!=='string'||!result.description.trim())throw Error('Invalid web research source');
  let uri:URL;try{uri=new URL(result.url);}catch{throw Error('Invalid web research URL');}
  if(uri.protocol!=='https:'||uri.username||uri.password||isIP(uri.hostname)||!uri.hostname.includes('.')||uri.hostname.endsWith('.localhost')||uri.hostname.endsWith('.local'))throw Error('Web research source requires a public HTTPS URL');
  uri.hash='';if(items.some(i=>i.uri===uri.href))continue;
  truncated ||= result.description.length>1000;
  items.push({id:'web-'+createHash('sha256').update(uri.href).digest('hex').slice(0,16),uri:uri.href,text:result.description.slice(0,1000),researchSource:'web',...(typeof result.title==='string'?{title:result.title.slice(0,200)}:{})});
 }
 if(!items.length)throw Error('No usable research sources found for web search');
 return {items,coverage:{source:'web' as const,returned:items.length,received:data.web.results.length,resultsOmitted:data.web.results.length-items.length,limit:5 as const,totalRelevant:null,content:'search-snippets' as const,excerptsTruncated:truncated}};
}
// One request per selected service, each <=128 KiB, shared 10-second deadline.
// Only the explicit query leaves the app. No page fetches, models or retries.
export async function researchEvidence(request:ResearchRequest,signal:AbortSignal,fetcher:typeof fetch=fetch,env:NodeJS.ProcessEnv=process.env):Promise<Evidence>{
 const parsed=researchRequest(request)!,key=searchKey(env);
 signal.throwIfAborted();
 if(parsed.mode!=='wikipedia'&&!key)throw Error('Web search is not configured on this server. Choose Wikipedia or no research, or ask the operator to configure web search.');
 const stop=new AbortController(),bounded=AbortSignal.any([signal,stop.signal,AbortSignal.timeout(10000)]);
 try{
  const results=await Promise.all([...(parsed.mode!=='web'?[wikipedia(parsed.query,bounded,fetcher)]:[]),...(parsed.mode!=='wikipedia'?[web(parsed.query,key!,bounded,fetcher)]:[])]);
  const items=results.flatMap(r=>r.items);
  const research:ResearchMetadata={mode:parsed.mode,scope:researchScope(parsed),providers:parsed.mode==='both'?['Wikipedia','Brave Search']:parsed.mode==='web'?['Brave Search']:['Wikipedia'],coverage:results.map(r=>r.coverage)};
  const hash=createHash('sha256').update(JSON.stringify({query:parsed.query,items,research})).digest('hex'),snapshotId=`research-${hash.slice(0,16)}`;
  if(JSON.stringify({snapshotId,sha256:hash,items}).length>18000)throw Error('Research snapshot exceeds prompt limit');
  return {source:'web',snapshotId,hash,items,research};
 }catch(error){stop.abort();throw error;}
}
