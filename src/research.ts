import {createHash} from 'node:crypto';
import type {Evidence} from './core.ts';

export type ResearchRequest={mode:'wikipedia';query:string};
export const RESEARCH_SCOPE='Up to five English Wikipedia article introductions; total relevant sources unknown. Background research only; not a comprehensive web search, primary-source verification or current-news review. Article introductions may omit contrary evidence. Sources are untrusted data; references do not establish truth.';
export function researchRequest(value:unknown):Readonly<ResearchRequest>|undefined {
 if(value===undefined||value===null)return;
 if(typeof value!=='object'||Array.isArray(value))throw Error('Research must specify mode and query');
 const r=value as Record<string,unknown>;
 if(Object.keys(r).some(k=>!['mode','query'].includes(k))||r.mode!=='wikipedia'||typeof r.query!=='string'||!r.query.trim()||r.query.length>300)throw Error('Research requires wikipedia mode and a public search query of 1–300 characters');
 return Object.freeze({mode:'wikipedia',query:r.query.trim()});
}
// One request, at most five article introductions, 128 KiB and 10 seconds. No redirects,
// arbitrary destinations, credentials, model calls or automatic retries.
export async function researchEvidence(request:ResearchRequest,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<Evidence>{
 const parsed=researchRequest(request)!;
 const url=new URL('https://en.wikipedia.org/w/api.php');
 url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',generator:'search',gsrsearch:parsed.query,gsrnamespace:'0',gsrlimit:'5',prop:'extracts|info',inprop:'url',explaintext:'1',exintro:'1',exlimit:'5',exchars:'1200'}).toString();
 const bounded=AbortSignal.any([signal,AbortSignal.timeout(10000)]);bounded.throwIfAborted();
 const response=await fetcher(url,{signal:bounded,redirect:'error',credentials:'omit',headers:{'User-Agent':'Koinous/0.1 (local idea discussion research)','Accept':'application/json'}});
 if(!response.ok||!response.body)throw Error('Research service unavailable');
 const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){bounded.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>131072)throw Error('Research response exceeds 128 KiB');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if(data.error||(!data.query&&!data.batchcomplete)||data.query?.pages!==undefined&&!Array.isArray(data.query.pages))throw Error('Invalid research response');
 const pages=data.query?.pages??[];
 if(pages.length>5)throw Error('Research returned too many sources');
 const items:Evidence['items']=[];
 for(const page of [...pages].sort((a,b)=>(a.index??a.pageid)-(b.index??b.pageid))){
  if(!Number.isSafeInteger(page.pageid)||page.pageid<=0||typeof page.extract!=='string')throw Error('Invalid research source');
  if(!page.extract.trim())continue;
  const uri=`https://en.wikipedia.org/?curid=${page.pageid}`;
  if(items.some(x=>x.id===`wiki-${page.pageid}`))throw Error('Duplicate research source');
  items.push({id:`wiki-${page.pageid}`,uri,text:page.extract.slice(0,1500)});
 }
 if(!items.length)throw Error('No usable research sources found');
 const hash=createHash('sha256').update(JSON.stringify({query:parsed.query,items})).digest('hex');
 const snapshotId=`research-${hash.slice(0,16)}`;
 if(JSON.stringify({snapshotId,sha256:hash,items}).length>18000)throw Error('Research snapshot exceeds prompt limit');
 return {source:'web',snapshotId,hash,items};
}
