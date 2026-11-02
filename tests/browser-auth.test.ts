import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createHash} from 'node:crypto';
import {BrowserAuth} from '../src/browser-auth.ts';
import type {OidcConfig,TokenExchange} from '../src/browser-auth.ts';
const keys=await generateKeyPair('RS256');const jwk={...await exportJWK(keys.publicKey),kid:'fixture',alg:'RS256'};
const config:OidcConfig={issuer:'https://identity.example',authorizationEndpoint:'https://identity.example/authorize',tokenEndpoint:'https://identity.example/token',clientId:'koinous',jwks:{keys:[jwk]},members:[{issuerSubject:'idp-alice',subject:'alice',tenant:'alpha'}]};
const epoch=1800000000000;
async function signed(nonce:string,claims:Record<string,unknown>={},key=keys.privateKey){return new SignJWT({sub:'idp-alice',nonce,...claims}).setProtectedHeader({alg:'RS256',kid:'fixture'}).setIssuer(typeof claims.iss==='string'?claims.iss:config.issuer).setAudience(claims.aud as string??'koinous').setIssuedAt(typeof claims.iat==='number'?claims.iat:epoch/1000).setExpirationTime(typeof claims.exp==='number'?claims.exp:epoch/1000+3600).sign(key);}
function transaction(auth:BrowserAuth){const start=auth.start();const url=new URL(start.location);return {url,cookie:start.cookie.split(';')[0],query:new URLSearchParams({state:url.searchParams.get('state')!,code:'offline-code'})};}
function setup(claims:Record<string,unknown>={}){let now=epoch,nonce='',exchanges=0;let body:URLSearchParams|undefined;const exchange:TokenExchange=async(_url,b)=>{exchanges++;body=b;return {id_token:await signed(nonce,claims)};};const auth=new BrowserAuth(config,'http://127.0.0.1:3031',exchange,()=>now);const tx=transaction(auth);nonce=tx.url.searchParams.get('nonce')!;return {auth,tx,exchanges:()=>exchanges,body:()=>body,advance:(ms:number)=>{now+=ms;}};}
test('OIDC PKCE transaction yields opaque expiring cookie; identity/CSRF stay server owned',async()=>{
 const f=setup();const result=await f.auth.finish(f.tx.query,f.tx.cookie);assert.deepEqual(result.identity,{subject:'alice',tenant:'alpha'});
 const body=f.body()!;assert.equal(body.get('redirect_uri'),'http://127.0.0.1:3031/auth/callback');assert.equal(body.get('grant_type'),'authorization_code');
 assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),f.tx.url.searchParams.get('code_challenge'));
 assert.match(result.cookies[0],/HttpOnly; SameSite=Lax; Path=\//);assert.ok(!result.cookies[0].includes('idp-alice'));
 const cookie=result.cookies[0].split(';')[0];assert.equal(f.auth.session(cookie)?.identity.tenant,'alpha');assert.ok(f.auth.session(cookie)?.csrf);
 await assert.rejects(f.auth.finish(f.tx.query,f.tx.cookie));assert.equal(f.exchanges(),1);
 f.advance(600001);assert.equal(f.auth.session(cookie),undefined);
});
test('state/browser binding and transaction expiry reject before exchange',async()=>{
 for(const variant of ['wrong-state','wrong-cookie','expired','duplicate-state','error']){
  const f=setup();if(variant==='wrong-state')f.tx.query.set('state','bad');if(variant==='expired')f.advance(300001);if(variant==='duplicate-state')f.tx.query.append('state',f.tx.query.get('state')!);if(variant==='error')f.tx.query.set('error','denied');
  await assert.rejects(f.auth.finish(f.tx.query,variant==='wrong-cookie'?'':f.tx.cookie));assert.equal(f.exchanges(),0);
 }
});
test('wrong issuer, audience, nonce, subject, expiry, future issuance and authorized party fail closed',async()=>{
 for(const claims of [{iss:'https://other.example'},{aud:'another-client'},{nonce:'bad'},{sub:'unknown'},{exp:epoch/1000-1},{iat:epoch/1000+600},{azp:'other'},{aud:['koinous','other']}]){
  const f=setup(claims);await assert.rejects(f.auth.finish(f.tx.query,f.tx.cookie));
 }
});
test('signature forgery and missing token cannot authenticate',async()=>{
 const foreign=await generateKeyPair('RS256');
 for(const response of [async(nonce:string)=>({id_token:await signed(nonce,{},foreign.privateKey)}),async()=>({access_token:'not-an-id-token'})]){
  let nonce='';const auth=new BrowserAuth(config,'http://127.0.0.1:3031',async()=>response(nonce),()=>epoch);const tx=transaction(auth);nonce=tx.url.searchParams.get('nonce')!;await assert.rejects(auth.finish(tx.query,tx.cookie));
 }
});
test('logout, restart and absolute expiry revoke sessions and active stream watchers',async()=>{
 const f=setup(),login=await f.auth.finish(f.tx.query,f.tx.cookie),cookie=login.cookies[0].split(';')[0];let closed=0;f.auth.watch(cookie,()=>{closed++;});
 assert.match(f.auth.revoke(cookie),/Max-Age=0/);assert.equal(closed,1);assert.equal(f.auth.session(cookie),undefined);
 const g=setup(),other=await g.auth.finish(g.tx.query,g.tx.cookie),c=other.cookies[0].split(';')[0];
 for(let i=0;i<5;i++){g.advance(300000);assert.ok(g.auth.session(c));}g.advance(300001);assert.equal(g.auth.session(c),undefined);
 const h=setup(),third=await h.auth.finish(h.tx.query,h.tx.cookie);h.auth.clear();assert.equal(h.auth.session(third.cookies[0]),undefined);
});
test('only pinned public keys and approved HTTPS endpoint origins are accepted',()=>{
 for(const cfg of [{...config,tokenEndpoint:'http://identity.example/token'},{...config,tokenEndpoint:'https://attacker.example/token'},{...config,members:[]},{...config,jwks:{keys:[{...jwk,d:'private'}]}}])assert.throws(()=>new BrowserAuth(cfg,'http://127.0.0.1:3031'));
});
