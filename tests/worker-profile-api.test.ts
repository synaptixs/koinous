import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createProtectedApplication} from '../src/secure-server.ts';
import {digest} from '../src/security.ts';
async function fixture(t:test.TestContext){
 const root=mkdtempSync(join(tmpdir(),'koinous-worker-api-'));const a=randomBytes(32).toString('base64url'),b=randomBytes(32).toString('base64url');
 const app=createProtectedApplication({root,mode:'real',principals:[{subject:'alice',tenant:'team',tokenSha256:digest(a)},{subject:'bob',tenant:'team',tokenSha256:digest(b)}],workerProfiles:[{subject:'alice',tenant:'team',provider:'codex'},{subject:'alice',tenant:'team',provider:'claude'},{subject:'bob',tenant:'team',provider:'codex'}]});
 t.after(async()=>{await app.shutdown();rmSync(root,{recursive:true,force:true});});
 async function request(path:string,method='GET',body?:unknown,token=a){
  const req=Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{url:path,method,headers:{host:'127.0.0.1:3031',authorization:'Bearer '+token}});
  let status=0,text='';const res={writeHead(s:number){status=s;},end(s=''){text+=s;}};
  await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);return {status,text,json:()=>JSON.parse(text)};
 }return {root,a,b,request};
}
test('protected profile listing and preflight resolve only the authenticated principal, including within a tenant',async t=>{
 const previous=process.env.KOINOUS_ENABLE_INFERENCE;process.env.KOINOUS_ENABLE_INFERENCE='1';t.after(()=>{if(previous===undefined)delete process.env.KOINOUS_ENABLE_INFERENCE;else process.env.KOINOUS_ENABLE_INFERENCE=previous;});
 const f=await fixture(t);writeFileSync(join(f.root,'credential-profiles/team/alice/codex/home/.codex/auth.json'),'SYNTHETIC_CREDENTIAL_MARKER',{mode:0o600});
 assert.equal((await f.request('/api/worker-profiles','GET',undefined,'bad')).status,401);
 assert.equal((await f.request('/api/worker-profiles')).json().profiles.length,2);
 assert.equal((await f.request('/api/worker-profiles','GET',undefined,f.b)).json().profiles.length,1);
 const alice=await f.request('/api/worker-profiles/codex/preflight','POST',{});assert.equal(alice.status,200);assert.equal(alice.json().credentialFilePresent,true);assert.equal(alice.json().authenticationVerified,false);
 const bob=await f.request('/api/worker-profiles/codex/preflight','POST',{},f.b);assert.equal(bob.status,200);assert.equal(bob.json().credentialFilePresent,false);
 assert.equal((await f.request('/api/worker-profiles/claude/preflight','POST',{},f.b)).status,404);
 for(const body of [{subject:'alice'},{path:f.root},{env:{HOME:f.root}},{prompt:'infer'}])assert.equal((await f.request('/api/worker-profiles/codex/preflight','POST',body,f.b)).status,400);
 assert.equal((await f.request('/api/sessions','POST',{prompt:'Never infer'})).status,403);
 assert.equal((await f.request('/api/health')).json().inferenceEnabled,false);
 const log=readFileSync(join(f.root,'security-audit.jsonl'),'utf8');assert.match(log,/metadata_inspection_completed/);assert.ok(!log.includes('SYNTHETIC_CREDENTIAL_MARKER'));assert.ok(!log.includes(f.root));assert.ok(!alice.text.includes(f.root));
});


test('SDK import preflight is owner-bound, accepts no execution parameters and cannot enable inference',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/api/worker-profiles/codex/sdk-preflight','POST',{},'bad')).status,401);
 assert.equal((await f.request('/api/worker-profiles/claude/sdk-preflight','POST',{},f.b)).status,404);
 for(const body of [{kind:'run'},{prompt:'no inference'},{proxy:'http://attacker'},{subject:'alice'}])assert.equal((await f.request('/api/worker-profiles/codex/sdk-preflight','POST',body)).status,400);
 const result=await f.request('/api/worker-profiles/codex/sdk-preflight','POST',{});
 assert.equal(result.status,200);assert.equal(result.json().sdkVersion,'0.166.0');assert.equal(result.json().inferenceEnabled,false);assert.equal(result.json().authenticationVerified,false);
 assert.equal((await f.request('/api/sessions','POST',{prompt:'Never infer'})).status,403);
 const log=readFileSync(join(f.root,'security-audit.jsonl'),'utf8');assert.match(log,/sdk_import_completed/);assert.ok(!log.includes(f.root));
});
