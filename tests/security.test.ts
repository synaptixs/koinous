import type {ParticipantId} from '../src/participants.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createProtectedApplication} from '../src/secure-server.ts';
import {digest,principals,containsSensitive,guardedAdapter,SecurityAudit} from '../src/security.ts';
import {ProviderFailure} from '../src/provider-runtime.ts';
import type {Adapter} from '../src/core.ts';
const secret='sk-'+ 'a'.repeat(30);
function fixture(t:test.TestContext,mode:'mock'|'real'='mock',adapterRun?:Adapter['run']){
 const root=mkdtempSync(join(tmpdir(),'koinous-secure-'));
 const a=randomBytes(32).toString('base64url'),b=randomBytes(32).toString('base64url');let calls=0;
 const config={root,port:3031,mode,principals:[{subject:'alice',tenant:'alpha',tokenSha256:digest(a)},{subject:'bob',tenant:'beta',tokenSha256:digest(b)}],adapterFactory:(_mode:string,ids:readonly ParticipantId[]=[])=>ids.map(id=>({id,async run(prompt:string,round:1|2|3,signal:AbortSignal){calls++;return adapterRun?adapterRun(prompt,round,signal):{text:'Synthetic answer',usage:{inputTokens:2,outputTokens:3,usd:null}};}}))};
 let app=createProtectedApplication(config);t.after(async()=>{await app.shutdown();rmSync(root,{recursive:true,force:true});});
 async function request(path:string,method='GET',body?:unknown,token:string|undefined=a,headers:Record<string,string>={}){
  const req=Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{url:path,method,headers:{host:'127.0.0.1:3031',...(token?{authorization:'Bearer '+token}:{}),...headers}});
  let status=0,text='';const res={writeHead(code:number){status=code;},write(chunk:string){text+=chunk;},end(chunk=''){text+=chunk;}};
  await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);return {status,text,json:()=>JSON.parse(text)};
 }
 async function complete(id:string,token=a){for(let i=0;i<100;i++){const r=await request('/api/sessions/'+id,'GET',undefined,token);if(['completed','partial','failed','cancelled'].includes(r.json().status))return r.json();await new Promise(resolve=>setImmediate(resolve));}throw Error('Discussion did not finish');}
 return {root,a,b,config,request,complete,calls:()=>calls,async restart(){await app.shutdown();app=createProtectedApplication(config);}};
}
test('protected routes require authentication; headers and query strings cannot select identity',async t=>{
 const f=fixture(t);
 for(const path of ['/','/app.js','/api/health','/api/sessions','/api/sessions/00000000-0000-0000-0000-000000000000/report'])assert.equal((await f.request(path,'GET',undefined,'')).status,401);
 assert.equal((await f.request('/api/health','GET',undefined,'wrong')).status,401);
 assert.equal((await f.request('/api/sessions?token='+f.a)).status,400);
 assert.equal((await f.request('/api/health','GET',undefined,f.a,{host:'evil.example:3031'})).status,403);
 assert.equal((await f.request('/api/health','GET',undefined,f.a,{origin:'https://evil.example'})).status,403);
 assert.equal((await f.request('/api/health','GET',undefined,f.a,{'sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await f.request('/api/health')).status,200);assert.equal(f.calls(),0);
 const audit=readFileSync(join(f.root,'security-audit.jsonl'),'utf8');assert.ok(!audit.includes(f.a));assert.ok(!audit.includes('evil.example'));
});
test('tenant isolation covers list, details, reports, SSE and mutations before and after restart',async t=>{
 const f=fixture(t);const created=await f.request('/api/sessions','POST',{prompt:'Alpha private idea',selection:{providers:['codex','claude']},tenant:'beta'},f.a,{'x-tenant-id':'beta'});
 assert.equal(created.status,201);const id=created.json().id;await f.complete(id);
 for(const suffix of ['', '/report','/events','/cancel','/interventions']){
  const r=await f.request('/api/sessions/'+id+suffix,suffix==='/cancel'||suffix==='/interventions'?'POST':'GET',{message:'x'},f.b);assert.equal(r.status,404);assert.ok(!r.text.includes('Alpha private'));
 }
 assert.ok(!(await f.request('/api/sessions','GET',undefined,f.b)).text.includes(id));
 await f.restart();assert.equal((await f.request('/api/sessions/'+id)).status,200);
 assert.equal((await f.request('/api/sessions/'+id,'GET',undefined,f.b)).status,404);
 assert.ok((await f.request('/api/sessions/'+id+'/report')).text.includes('Alpha private idea'));
 assert.ok((await f.request('/api/sessions/'+id+'/events')).text.includes('session.finished'));
 assert.equal(f.calls(),6);
});
test('DLP rejects input/context/model strings before calls or discussion persistence',async t=>{
 const f=fixture(t);
 for(const body of [{prompt:secret},{prompt:'idea',context:secret},{prompt:'idea',selection:{providers:['codex','claude'],models:{codex:secret}}}])assert.equal((await f.request('/api/sessions','POST',body)).status,422);
 assert.equal(f.calls(),0);assert.ok(!(await f.request('/api/sessions')).text.includes(secret));
 assert.ok(!readFileSync(join(f.root,'security-audit.jsonl'),'utf8').includes(secret));
 assert.equal((await f.request('/api/sessions','POST',{prompt:'idea',grounding:'configured'})).status,403);
});
test('guarded adapters reject egress/peer secrets, retain usage and sanitize provider errors',async()=>{
 let calls=0,blocks=0;const wrap=guardedAdapter({id:'codex',async run(){calls++;return {text:secret,usage:{inputTokens:10,outputTokens:20,usd:null}};}},()=>{blocks++;});
 await assert.rejects(wrap.run(secret,1,new AbortController().signal),/before provider dispatch/);assert.equal(calls,0);
 await assert.rejects(wrap.run('safe',1,new AbortController().signal),e=>e instanceof ProviderFailure&&e.code==='dlp_blocked'&&e.details.usage?.inputTokens===10&&!e.message.includes(secret));assert.equal(blocks,2);
 const broken=guardedAdapter({id:'claude',async run(){throw new ProviderFailure('raw',secret,{responseId:secret,usage:{outputTokens:7,usd:null}});}},()=>{});
 await assert.rejects(broken.run('safe',1,new AbortController().signal),e=>e instanceof ProviderFailure&&e.message==='Provider request failed'&&e.details.responseId===undefined&&e.details.usage?.outputTokens===7);
});
test('audit tampering prevents access and is detected on restart',async t=>{
 const f=fixture(t);await f.request('/api/health');const path=join(f.root,'security-audit.jsonl');
 writeFileSync(path,readFileSync(path,'utf8').replace('alice','mallory'));
 assert.equal((await f.request('/api/health')).status,503);assert.equal(f.calls(),0);
 assert.throws(()=>new SecurityAudit(path),/integrity/);
});
test('protected real mode refuses inference even if global inference is enabled',async t=>{
 const old=process.env.KOINOUS_ENABLE_INFERENCE;process.env.KOINOUS_ENABLE_INFERENCE='1';t.after(()=>{if(old===undefined)delete process.env.KOINOUS_ENABLE_INFERENCE;else process.env.KOINOUS_ENABLE_INFERENCE=old;});
 const f=fixture(t,'real');const r=await f.request('/api/sessions','POST',{prompt:'Never infer'});assert.equal(r.status,403);assert.match(r.text,/tenant_provider_isolation_pending/);assert.equal(f.calls(),0);assert.equal((await f.request('/api/health')).json().inferenceEnabled,false);
});
test('invalid principals and symlink tenant roots fail closed',t=>{
 for(const p of [[],[{}],[{subject:'a',tenant:'../b',tokenSha256:'a'.repeat(64)}],[{subject:'a',tenant:'a',tokenSha256:'x'}]])assert.throws(()=>principals(p));
 const f=fixture(t);mkdirSync(join(f.root,'elsewhere'),{mode:0o700});symlinkSync(join(f.root,'elsewhere'),join(f.root,'tenants','evil'));
 assert.throws(()=>createProtectedApplication({...f.config,principals:[{subject:'e',tenant:'evil',tokenSha256:digest('x'.repeat(43))}]}),/symlink/);
 assert.equal(containsSensitive('-----BEGIN PRIVATE KEY-----'),true);assert.equal(containsSensitive('123-45-6789'),true);assert.equal(containsSensitive('Ordinary synthetic idea'),false);
});


test('single-writer lock rejects a second process and audit deletion fails closed',async t=>{
 const f=fixture(t);assert.throws(()=>createProtectedApplication(f.config),/EEXIST/);
 await f.request('/api/health');rmSync(join(f.root,'security-audit.jsonl'));
 assert.equal((await f.request('/api/sessions','POST',{prompt:'No write'})).status,503);assert.equal(f.calls(),0);
});
test('DLP audit failures cannot leak corrupt audit contents through adapter errors',async()=>{
 const adapter=guardedAdapter({id:'codex',async run(){return {text:secret};}},()=>{throw Error(secret);});
 await assert.rejects(adapter.run('safe',1,new AbortController().signal),e=>e instanceof ProviderFailure&&e.code==='audit_unavailable'&&!e.message.includes(secret));
});


test('active tenant isolation blocks peer cancellation/interventions and DLP blocks intervention persistence',async t=>{
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});let started!:()=>void;const began=new Promise<void>(r=>{started=r;});
 const f=fixture(t,'mock',async()=>{started();await gate;return {text:'safe'};});
 const response=await f.request('/api/sessions','POST',{prompt:'Active idea',maxRounds:1,selection:{providers:['codex','claude']}});const id=response.json().id;await began;
 for(const suffix of ['/events','/cancel','/interventions'])assert.equal((await f.request('/api/sessions/'+id+suffix,suffix==='/events'?'GET':'POST',{message:'attack'},f.b)).status,404);
 assert.equal((await f.request('/api/sessions/'+id+'/interventions','POST',{message:secret})).status,422);
 assert.equal((await f.request('/api/sessions/'+id+'/cancel','POST',{})).status,200);release();
 assert.equal((await f.complete(id)).status,'cancelled');assert.ok(!(await f.request('/api/sessions/'+id+'/events')).text.includes(secret));
});
