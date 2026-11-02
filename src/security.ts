import {createHash,timingSafeEqual} from 'node:crypto';
import {appendFileSync,closeSync,constants,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync} from 'node:fs';
import type {Adapter,Usage} from './core.ts';
import {ProviderFailure,tokenCount,cost} from './provider-runtime.ts';

export type Principal=Readonly<{subject:string;tenant:string;tokenSha256:string}>;
const ID=/^[a-zA-Z0-9_-]{1,64}$/;
export const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export function principals(value:unknown):readonly Principal[]{
 if(!Array.isArray(value)||value.length<1||value.length>100)throw Error('Configure 1–100 application principals');
 const seen=new Set<string>();
 return Object.freeze(value.map(p=>{
  if(!p||typeof p!=='object'||typeof p.subject!=='string'||typeof p.tenant!=='string'||!ID.test(p.subject)||!ID.test(p.tenant)||typeof p.tokenSha256!=='string'||!/^([a-f0-9]{64})$/.test(p.tokenSha256)||seen.has(p.tokenSha256))throw Error('Invalid or duplicate application principal');
  seen.add(p.tokenSha256);return Object.freeze({subject:p.subject,tenant:p.tenant,tokenSha256:p.tokenSha256});
 }));
}
export function authenticate(header:string|undefined,users:readonly Principal[]):Principal|undefined{
 if(!header||!/^Bearer [A-Za-z0-9_-]{43,128}$/.test(header))return;
 const hash=Buffer.from(digest(header.slice(7)),'hex');
 return users.find(p=>timingSafeEqual(hash,Buffer.from(p.tokenSha256,'hex')));
}
export function privateDirectory(path:string){
 mkdirSync(path,{recursive:true,mode:0o700});const stat=lstatSync(path);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw Error('Security directory must be private and not a symlink');
}
// Deliberately bounded detection, not a claim of comprehensive PII/secret classification.
export function containsSensitive(value:unknown):boolean{
 const text=typeof value==='string'?value:JSON.stringify(value)??'';
 return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-|xai-|ghp_)[A-Za-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}\b|\bBearer\s+[A-Za-z0-9_.~-]{20,}|\b\d{3}-\d{2}-\d{4}\b/i.test(text);
}
export type AuditDecision={subject?:string;tenant?:string;action:string;resource?:string;decision:'allow'|'deny';reason:string};
export class SecurityAudit {
 private path:string;private tip:unknown;
 constructor(path:string){this.path=path;this.tip=this.read().at(-1)?.hash??'0'.repeat(64);}
 private read():Array<Record<string,unknown>>{
  let fd:number;
  try{fd=openSync(this.path,constants.O_RDONLY|constants.O_NOFOLLOW);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
  let raw:string;try{const stat=lstatSync(this.path);if(!stat.isFile()||(stat.mode&0o077)!==0||stat.size>4*1024*1024)throw Error('Invalid audit file');raw=readFileSync(fd,'utf8');}finally{closeSync(fd);}
  if(raw&&!raw.endsWith('\n'))throw Error('Incomplete audit record');
  const rows=raw.trim()?raw.trim().split('\n').map(line=>JSON.parse(line)):[];let previous='0'.repeat(64);
  for(const [i,row] of rows.entries()){
   const {hash,...record}=row;if(record.seq!==i+1||record.previous!==previous||hash!==digest(JSON.stringify(record)))throw Error('Audit integrity check failed');previous=hash;
  }return rows;
 }
 record(event:AuditDecision){
  const rows=this.read();if((rows.at(-1)?.hash??'0'.repeat(64))!==this.tip)throw Error('Audit changed outside this writer');const record={seq:rows.length+1,previous:rows.at(-1)?.hash??'0'.repeat(64),at:new Date().toISOString(),...event};
  const fd=openSync(this.path,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
  try{appendFileSync(fd,JSON.stringify({...record,hash:digest(JSON.stringify(record))})+'\n');fsyncSync(fd);this.tip=digest(JSON.stringify(record));}finally{closeSync(fd);}
 }
}
function safeUsage(usage:Usage|undefined):Usage|undefined{
 if(!usage)return;const out:Usage={usd:null};
 for(const key of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'] as const){const n=tokenCount(usage[key]);if(n!==undefined)out[key]=n;}
 const usd=cost(usage.usd);if(usd!==undefined)out.usd=usd;
 return out;
}
export function guardedAdapter(adapter:Adapter,onBlock:()=>void):Adapter{
 const blocked=()=>{try{onBlock();}catch{throw new ProviderFailure('audit_unavailable','Security audit unavailable');}};
 return {id:adapter.id,maxTotalTokensPerCall:adapter.maxTotalTokensPerCall,
  prepare:adapter.prepare?async signal=>{try{await adapter.prepare!(signal);}catch{throw new ProviderFailure('provider_prepare','Provider preparation failed');}}:undefined,
  dispose:adapter.dispose?async()=>{try{await adapter.dispose!();}catch{throw new ProviderFailure('provider_cleanup','Provider cleanup failed');}}:undefined,
  async run(prompt,round,signal){
   if(containsSensitive(prompt)){blocked();throw new ProviderFailure('dlp_blocked','Sensitive content blocked before provider dispatch');}
   let reply;
   try{reply=await adapter.run(prompt,round,signal);}catch(e){throw new ProviderFailure('provider_error','Provider request failed',{usage:safeUsage(e instanceof ProviderFailure?e.details.usage:undefined)});}
   if(containsSensitive(reply)){blocked();throw new ProviderFailure('dlp_blocked','Sensitive provider response withheld',{usage:safeUsage(reply.usage)});}
   return reply;
  }};
}
