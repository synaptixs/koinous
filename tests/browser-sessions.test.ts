import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createProtectedApplication} from '../src/secure-server.ts';
import type {TokenExchange} from '../src/browser-auth.ts';
const keys=await generateKeyPair('RS256'),jwk={...await exportJWK(keys.publicKey),kid:'test',alg:'RS256'};
async function fixture(t:test.TestContext,mode:'real'|'mock'='real'){
 const root=mkdtempSync(join(tmpdir(),'koinous-browser-'));let now=1800000000000;const nonces=new Map<string,string>();let exchanges=0;
 const exchange:TokenExchange=async(_url,body)=>{exchanges++;const code=body.get('code')!;return {id_token:await new SignJWT({sub:code,nonce:nonces.get(code),tenant:'attacker-controlled'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://idp.example').setAudience('client').setIssuedAt(now/1000).setExpirationTime(now/1000+3600).sign(keys.privateKey)};};
 const app=createProtectedApplication({root,mode,now:()=>now,exchange,oidc:{issuer:'https://idp.example',authorizationEndpoint:'https://idp.example/authorize',tokenEndpoint:'https://idp.example/token',clientId:'client',jwks:{keys:[jwk]},members:[{issuerSubject:'alice-id',subject:'alice',tenant:'alpha'},{issuerSubject:'bob-id',subject:'bob',tenant:'beta'}]}});
 t.after(async()=>{await app.shutdown();rmSync(root,{recursive:true,force:true});});
 async function request(path:string,method='GET',cookie?:string,body?:unknown,headers:Record<string,string>={}){
  const req=Object.assign(Readable.from(body===undefined?[]:[JSON.stringify(body)]),{url:path,method,headers:{host:'127.0.0.1:3031',...(cookie?{cookie}:{}),...headers}});
  let status=0,text='',responseHeaders:Record<string,any>={};const res={writeHead(s:number,h:Record<string,any>){status=s;responseHeaders=h;},write(x:string){text+=x;},end(x=''){text+=x;}};
  await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);return {status,text,headers:responseHeaders,json:()=>JSON.parse(text)};
 }
 async function login(subject='alice-id'){
  const start=await request('/auth/login');assert.equal(start.status,302);const url=new URL(start.headers.Location);nonces.set(subject,url.searchParams.get('nonce')!);
  const txCookie=start.headers['Set-Cookie'].split(';')[0],path='/auth/callback?'+new URLSearchParams({state:url.searchParams.get('state')!,code:subject});
  const result=await request(path,'GET',txCookie,undefined,{'sec-fetch-site':'cross-site'});return {result,path,txCookie,cookie:result.headers['Set-Cookie'][0]?.split(';')[0]};
 }
 return {root,request,login,advance:(ms:number)=>{now+=ms;},exchanges:()=>exchanges};
}
test('enterprise login serves protected review UI and enforces fixed tenant membership',async t=>{
 const f=await fixture(t);assert.match((await f.request('/')).text,/Enterprise sign in/);assert.equal((await f.request('/api/sessions')).status,401);
 const alice=await f.login();assert.equal(alice.result.status,303);assert.equal(alice.result.headers.Location,'/');assert.match(alice.cookie,/^koinous_session=/);
 const identity=(await f.request('/api/auth/session','GET',alice.cookie)).json();assert.equal(identity.tenant,'alpha');assert.equal(identity.subject,'alice');
 const bob=await f.login('bob-id');assert.equal((await f.request('/api/auth/session','GET',bob.cookie)).json().tenant,'beta');
 assert.match((await f.request('/','GET',alice.cookie)).text,/browser-session.js/);assert.equal((await f.request('/app.js','GET',alice.cookie)).status,200);
 assert.equal((await f.request('/browser-session.js','GET',alice.cookie)).status,200);
 const health=(await f.request('/api/health','GET',alice.cookie)).json();assert.equal(health.inferenceEnabled,false);assert.equal(health.uiSupported,true);assert.equal(health.availableProviders.length,3);
 assert.equal((await f.request(alice.path,'GET',alice.txCookie)).status,401);assert.equal(f.exchanges(),2);
 const log=readFileSync(join(f.root,'security-audit.jsonl'),'utf8');assert.ok(!log.includes('alice-id'));assert.ok(!log.includes(alice.cookie.split('=')[1]));assert.ok(!log.includes('code='));
});
test('cookie mutations require Origin and CSRF; logout revokes cookie without provider calls',async t=>{
 const f=await fixture(t),alice=await f.login(),identity=(await f.request('/api/auth/session','GET',alice.cookie)).json();
 for(const headers of ([{},{origin:'http://127.0.0.1:3031'},{origin:'https://attacker.example','x-csrf-token':identity.csrfToken}] as Array<Record<string,string>>))assert.equal((await f.request('/auth/logout','POST',alice.cookie,{},headers)).status,403);
 assert.equal((await f.request('/api/sessions','POST',alice.cookie,{prompt:'No inference'},{origin:'http://127.0.0.1:3031','x-csrf-token':identity.csrfToken})).status,403);
 assert.equal((await f.request('/auth/logout','POST',alice.cookie,{}, {origin:'http://127.0.0.1:3031','x-csrf-token':identity.csrfToken})).status,200);
 assert.equal((await f.request('/api/sessions','GET',alice.cookie)).status,401);
});
test('expired sessions, callback errors, duplicate cookies and canonical host checks fail closed',async t=>{
 const f=await fixture(t),alice=await f.login();
 assert.equal((await f.request('/api/auth/session','GET',alice.cookie+'; '+alice.cookie)).status,401);
 assert.equal((await f.request('/auth/login','GET',undefined,undefined,{host:'localhost:3031'})).status,403);
 assert.equal((await f.request('/auth/callback?state=invalid&code=secret')).status,401);
 f.advance(600001);assert.equal((await f.request('/api/health','GET',alice.cookie)).status,401);
});
test('signed but unenrolled enterprise identities cannot create a browser session',async t=>{
 const f=await fixture(t);const unknown=await f.login('unlisted-id');assert.equal(unknown.result.status,401);assert.ok(!unknown.result.text.includes('unlisted-id'));
});


test('browser tenant cookies cannot read another tenant discussion or its report/events',async t=>{
 const f=await fixture(t,'mock'),alice=await f.login(),bob=await f.login('bob-id');
 const identity=(await f.request('/api/auth/session','GET',alice.cookie)).json();
 const created=await f.request('/api/sessions','POST',alice.cookie,{prompt:'Private alpha idea',maxRounds:1,selection:{providers:['codex','claude']}},{origin:'http://127.0.0.1:3031','x-csrf-token':identity.csrfToken});assert.equal(created.status,201);
 const id=created.json().id;
 for(const suffix of ['','/report','/events'])assert.equal((await f.request('/api/sessions/'+id+suffix,'GET',bob.cookie)).status,404);
 assert.ok(!(await f.request('/api/sessions','GET',bob.cookie)).text.includes('Private alpha idea'));
 assert.equal((await f.request('/api/sessions/'+id,'GET',alice.cookie)).status,200);
});
