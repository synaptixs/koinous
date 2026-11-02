import {createHash} from 'node:crypto';
import type {Evidence} from './core.ts';

export type Provenance={entity_id:string;uri:string;path:string;start_line:number;end_line:number;text_sha256:string};
export type PublishedManifest={schema_version:1;snapshot_id:string;repository:string;commit_sha:string;
 publication:{status:'published';pipeline_id:string;reviewed:true;merged:true;checks_passed:true};
 indexes:Array<{name:string;snapshot_id:string;commit_sha:string}>;entities:Provenance[]};
type RecordValue=Record<string,unknown>;
const reject=()=>{throw Error('Published PKG validation failed: invalid, stale, or unresolvable evidence');};
function record(x:unknown):RecordValue {if(!x||typeof x!=='object'||Array.isArray(x))return reject();return x as RecordValue;}
function text(x:unknown,max=300):string {if(typeof x!=='string'||!x.length||x.length>max||/[\x00-\x1f]/.test(x))return reject();return x;}
function array(x:unknown,max:number):unknown[]{if(!Array.isArray(x)||x.length>max)return reject();return x;}
function digest(x:unknown):string {const s=text(x,64);if(!/^[a-f0-9]{64}$/.test(s))return reject();return s;}
function revision(x:unknown):string {const s=text(x,40);if(!/^[a-f0-9]{40}$/.test(s))return reject();return s;}
function id(x:unknown):string {const s=text(x,128);if(!/^[a-zA-Z0-9:._/-]+$/.test(s))return reject();return s;}
export function canonicalJSON(x:unknown):string {
 if(Array.isArray(x))return '['+x.map(canonicalJSON).join(',')+']';
 if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON((x as RecordValue)[k])).join(',')+'}';
 return JSON.stringify(x);
}
export const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
function provenance(value:unknown,repository:string,commit:string):Provenance{
 const p=record(value),path=text(p.path,500),uri=text(p.uri,1000);
 if(path.startsWith('/')||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..')||/[?#]/.test(path))return reject();
 if(!Number.isSafeInteger(p.start_line)||!Number.isSafeInteger(p.end_line)||(p.start_line as number)<1||(p.end_line as number)<(p.start_line as number))return reject();
 const expected=`pkg://${repository}/${commit}/${path}#L${p.start_line}-L${p.end_line}`;
 if(uri!==expected)return reject();
 return {entity_id:id(p.entity_id),uri,path,start_line:p.start_line as number,end_line:p.end_line as number,text_sha256:digest(p.text_sha256)};
}
function indexes(value:unknown,snapshot:string,commit:string){
 const rows=array(value,20).map(v=>{const r=record(v);if(r.snapshot_id!==snapshot||r.commit_sha!==commit)return reject();return {name:id(r.name),snapshot_id:snapshot,commit_sha:commit};});
 if(!rows.length||new Set(rows.map(x=>x.name)).size!==rows.length)return reject();
 return rows.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
}
export function readPublishedManifest(raw:string,expectedHash:string,expectedSnapshot:string):PublishedManifest{
 if(Buffer.byteLength(raw)>2_000_000||sha256(raw)!==digest(expectedHash))return reject();
 const m=record(JSON.parse(raw)),snapshot=id(m.snapshot_id),repository=id(m.repository),commit=revision(m.commit_sha),publication=record(m.publication);
 if(m.schema_version!==1||snapshot!==expectedSnapshot||repository.includes('/')||publication.status!=='published'||publication.reviewed!==true||publication.merged!==true||publication.checks_passed!==true)return reject();
 const entities=array(m.entities,10000).map(e=>provenance(e,repository,commit));
 if(!entities.length||new Set(entities.map(e=>e.entity_id)).size!==entities.length)return reject();
 return {schema_version:1,snapshot_id:snapshot,repository,commit_sha:commit,
 publication:{status:'published',pipeline_id:text(publication.pipeline_id),reviewed:true,merged:true,checks_passed:true},
 indexes:indexes(m.indexes,snapshot,commit),entities};
}
function envelope(value:unknown,m:PublishedManifest){const r=record(value);if(r.snapshot_id!==m.snapshot_id||r.commit_sha!==m.commit_sha||r.repository!==m.repository)return reject();return r;}
export function validateSearch(value:unknown,m:PublishedManifest){
 const r=envelope(value,m);
 if(canonicalJSON(indexes(r.indexes,m.snapshot_id,m.commit_sha))!==canonicalJSON(m.indexes))return reject();
 const results=array(r.results,20).map(v=>{const e=record(v);if(typeof e.text!=='string'||!e.text.length||e.text.length>12000)return reject();return {evidence_id:id(e.evidence_id),entity_id:id(e.entity_id),text:e.text};});
 if(!results.length||new Set(results.map(e=>e.evidence_id)).size!==results.length||new Set(results.map(e=>e.entity_id)).size!==results.length)return reject();
 if(!Number.isSafeInteger(r.total)||(r.total as number)<results.length||r.truncated!==((r.total as number)>results.length))return reject();
 const known=new Map(m.entities.map(e=>[e.entity_id,e]));
 for(const e of results)if(!known.has(e.entity_id)||sha256(e.text)!==known.get(e.entity_id)!.text_sha256)return reject();
 return {results,total:r.total as number,truncated:r.truncated as boolean};
}
export function resolvePublishedEvidence(manifest:PublishedManifest,manifestHash:string,searchValue:unknown,provenanceValue:unknown,source:'file'|'mcp'):Evidence{
 const search=validateSearch(searchValue,manifest),response=envelope(provenanceValue,manifest);
 const resolved=array(response.entities,20).map(v=>provenance(v,manifest.repository,manifest.commit_sha));
 if(resolved.length!==search.results.length||new Set(resolved.map(x=>x.entity_id)).size!==resolved.length)return reject();
 const byId=new Map(resolved.map(e=>[e.entity_id,e])),known=new Map(manifest.entities.map(e=>[e.entity_id,e]));
 const items=search.results.map(e=>{const p=byId.get(e.entity_id);if(!p||canonicalJSON(p)!==canonicalJSON(known.get(e.entity_id)))return reject();return {id:e.evidence_id,uri:p.uri,text:e.text,provenance:{...p,commit_sha:manifest.commit_sha,pipeline_id:manifest.publication.pipeline_id}};});
 const publication={manifestSha256:manifestHash,repository:manifest.repository,commitSha:manifest.commit_sha,pipelineId:manifest.publication.pipeline_id,indexes:manifest.indexes.map(i=>i.name),total:search.total,returned:items.length,truncated:search.truncated};
 const hash=sha256(canonicalJSON({snapshotId:manifest.snapshot_id,publication,items}));
 if(JSON.stringify({snapshotId:manifest.snapshot_id,sha256:hash,items}).length>18000)throw Error('Published PKG evidence exceeds the complete prompt budget; reduce top_k');
 const evidence:Evidence={snapshotId:manifest.snapshot_id,hash,source,items,publication};
 // Freeze canonical facts so all rounds use exactly the validated pack.
 const freeze=(x:unknown):void=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}};freeze(evidence);
 return evidence;
}
export type PKGClient={listTools(params?:undefined,options?:{signal?:AbortSignal;timeout:number}):Promise<{tools:Array<{name:string}>}>;
 callTool(params:{name:string;arguments:Record<string,unknown>},schema?:undefined,options?:{signal?:AbortSignal;timeout:number}):Promise<unknown>};
function payload(raw:unknown):unknown {
 const r=record(raw);if(r.isError===true)return reject();
 if(r.structuredContent!==undefined){if(Buffer.byteLength(JSON.stringify(r.structuredContent))>100000)return reject();return r.structuredContent;}
 const blocks=array(r.content,1);if(blocks.length!==1)return reject();const block=record(blocks[0]);
 if(block.type!=='text'||typeof block.text!=='string'||Buffer.byteLength(block.text)>100000)return reject();return JSON.parse(block.text);
}
export async function fetchPublishedEvidence(client:PKGClient,manifest:PublishedManifest,manifestHash:string,query:string,topK=8,signal?:AbortSignal):Promise<Evidence>{
 if(!query.trim()||query.length>6000||!Number.isInteger(topK)||topK<1||topK>20)throw Error('PKG query or top_k is invalid');
 const options={signal,timeout:10000};signal?.throwIfAborted();
 const tools=await client.listTools(undefined,options);
 for(const name of ['search_pkg','get_provenance'])if(!tools.tools.some(t=>t.name===name))throw Error('Required read-only PKG contract unavailable');
 const pin={snapshot_id:manifest.snapshot_id,commit_sha:manifest.commit_sha,repository:manifest.repository};
 const search=payload(await client.callTool({name:'search_pkg',arguments:{...pin,query,top_k:topK}},undefined,options));
 const checked=validateSearch(search,manifest);if(checked.results.length>topK)throw Error('PKG returned more results than requested');
 const resolved=payload(await client.callTool({name:'get_provenance',arguments:{...pin,entity_ids:checked.results.map(e=>e.entity_id)}},undefined,options));
 signal?.throwIfAborted();return resolvePublishedEvidence(manifest,manifestHash,search,resolved,'mcp');
}
