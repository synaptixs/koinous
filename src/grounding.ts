import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {Evidence} from './core.ts';
import {readPublishedManifest,resolvePublishedEvidence,fetchPublishedEvidence} from './published-pkg.ts';
import type {PublishedManifest} from './published-pkg.ts';

const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export async function getEvidence(query='',signal?:AbortSignal):Promise<Evidence>{
 const env={...process.env};signal?.throwIfAborted();
 const strict=!!(env.MCP_SERVER_URL||env.PKG_MANIFEST_FILE||env.PKG_MANIFEST_SHA256||env.MCP_SNAPSHOT_ID);
 if(strict){
   if(!env.PKG_MANIFEST_FILE||!env.PKG_MANIFEST_SHA256||!env.MCP_SNAPSHOT_ID)throw Error('Published PKG requires PKG_MANIFEST_FILE, PKG_MANIFEST_SHA256 and MCP_SNAPSHOT_ID; no unverified fallback');
   const raw=await readFile(resolve(env.PKG_MANIFEST_FILE),{encoding:'utf8',signal});
   const manifest=readPublishedManifest(raw,env.PKG_MANIFEST_SHA256,env.MCP_SNAPSHOT_ID);
   if(env.MCP_SERVER_URL)return mcpEvidence(manifest,env,query,signal);
   if(!env.EVIDENCE_FILE)throw Error('Offline published PKG requires EVIDENCE_FILE with search and provenance envelopes');
   const bundleRaw=await readFile(resolve(env.EVIDENCE_FILE),{encoding:'utf8',signal});
   if(Buffer.byteLength(bundleRaw)>200000)throw Error('Published PKG bundle exceeds limit');
   const bundle=JSON.parse(bundleRaw);
   return resolvePublishedEvidence(manifest,env.PKG_MANIFEST_SHA256,bundle.search,bundle.provenance,'file');
 }
 // Curated/synthetic fixtures remain usable, but are never labelled published/verified.
 const file=resolve(env.EVIDENCE_FILE || 'examples/demo-evidence.json');
 const raw=await readFile(file,{encoding:'utf8',signal});
 if(raw.length>100_000) throw new Error('Evidence file exceeds 100 KB POC limit');
 const data=JSON.parse(raw);
 if(!Array.isArray(data.items))throw new Error('Evidence must contain items array');
 const items=data.items.slice(0,20).map((e:any,i:number)=>({id:String(e.id||`ref-${i+1}`).slice(0,80),uri:String(e.uri||'unknown').slice(0,300),text:String(e.text||'').slice(0,1500)}));
 return {snapshotId:String(data.snapshotId || hash(raw).slice(0,12)),hash:hash(raw),items,source:'file'};
}

async function mcpEvidence(manifest:PublishedManifest,env:NodeJS.ProcessEnv,query:string,signal?:AbortSignal):Promise<Evidence> {
 if(env.MCP_READ_TOOL&&env.MCP_READ_TOOL!=='search_pkg')throw Error('Published PKG only permits the audited search_pkg/get_provenance contract');
 const args=JSON.parse(env.MCP_TOOL_ARGS_JSON||'{}');
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!['query','top_k'].includes(k)))throw Error('MCP_TOOL_ARGS_JSON only accepts query and top_k; publication pins cannot be overridden');
 const url=new URL(env.MCP_SERVER_URL!);
 if(url.username||url.password||url.hash)throw Error('MCP URL cannot embed credentials or fragments');
 if(url.protocol!=='https:' && !(['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol==='http:'))throw new Error('Remote MCP must use HTTPS');
 const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
 const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const client=new Client({name:'tri-agent-grounding-gateway',version:'0.1.0'});
 const headers:Record<string,string>={};if(env.MCP_BEARER_TOKEN)headers.Authorization=`Bearer ${env.MCP_BEARER_TOKEN}`;
 const transport=new StreamableHTTPClientTransport(url,{requestInit:{headers}});
 try {
   await client.connect(transport,{timeout:10000,signal});
   return await fetchPublishedEvidence(client,manifest,env.PKG_MANIFEST_SHA256!,query||args.query,args.top_k??8,signal);
 } finally {await client.close();}
}
