import {randomBytes,createHash} from 'node:crypto';
import {createLocalJWKSet,jwtVerify} from 'jose';
import type {JSONWebKeySet} from 'jose';
export type Identity={subject:string;tenant:string};
export type OidcConfig={issuer:string;authorizationEndpoint:string;tokenEndpoint:string;clientId:string;jwks:JSONWebKeySet;members:Array<Identity&{issuerSubject:string}>};
export type TokenExchange=(endpoint:string,body:URLSearchParams)=>Promise<unknown>;
const random=()=>randomBytes(32).toString('base64url');
const hash=(v:string)=>createHash('sha256').update(v).digest('base64url');
const SESSION='koinous_session',TRANSACTION='koinous_login';
function cookie(header:string|undefined,name:string){const matches=(header??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));return matches.length===1?matches[0].slice(name.length+1):undefined;}
function setCookie(name:string,value:string,seconds:number){return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}`;}
export async function exchangeCode(endpoint:string,body:URLSearchParams):Promise<unknown>{
 const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!response.ok||!response.body)throw Error('Identity exchange failed');
 const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768)throw Error('Identity response too large');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}finally{await reader.cancel();}
}
export class BrowserAuth {
 private config:OidcConfig;private origin:string;private keys:ReturnType<typeof createLocalJWKSet>;private exchange:TokenExchange;private now:()=>number;
 private pending=new Map<string,{binding:string;nonce:string;verifier:string;expires:number}>();
 private sessions=new Map<string,{identity:Identity;csrf:string;expires:number;last:number;closed:Set<()=>void>}>();
 constructor(config:OidcConfig,origin:string,exchange:TokenExchange=exchangeCode,now:()=>number=Date.now){
  this.config=structuredClone(config);this.origin=origin;this.exchange=exchange;this.now=now;
  for(const endpoint of [config.issuer,config.authorizationEndpoint,config.tokenEndpoint]){const u=new URL(endpoint);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search)throw Error('OIDC endpoints must be explicit HTTPS URLs');}
  if(typeof config.clientId!=='string'||!config.clientId||config.clientId.length>256||new URL(config.authorizationEndpoint).origin!==new URL(config.issuer).origin||new URL(config.tokenEndpoint).origin!==new URL(config.issuer).origin)throw Error('Invalid OIDC client or endpoint origin');
  if(!Array.isArray(config.members)||!config.members.length||config.members.length>100||new Set(config.members.map(m=>m.issuerSubject)).size!==config.members.length||config.members.some(m=>typeof m.issuerSubject!=='string'||!m.issuerSubject||m.issuerSubject.length>256||typeof m.subject!=='string'||typeof m.tenant!=='string'||!/^[-\w]{1,64}$/.test(m.subject)||!/^[-\w]{1,64}$/.test(m.tenant)))throw Error('Explicit OIDC memberships required');
  if(!config.jwks?.keys?.length||config.jwks.keys.length>10||config.jwks.keys.some(k=>k.kty!=='RSA'||['d','p','q','dp','dq','qi','oth','k'].some(field=>field in k)||k.alg&&k.alg!=='RS256'))throw Error('Public RS256 signing keys required');
  this.keys=createLocalJWKSet(this.config.jwks);
 }
 tenants(){return this.config.members.map(m=>m.tenant);}
 private prune(){const now=this.now();for(const [k,v] of this.pending)if(v.expires<=now)this.pending.delete(k);for(const [k,v] of this.sessions)if(v.expires<=now||v.last+600000<=now){this.sessions.delete(k);for(const close of v.closed)close();}}
 start(){this.prune();if(this.pending.size>=100)throw Error('Login capacity exceeded');const state=random(),binding=random(),nonce=random(),verifier=random();this.pending.set(state,{binding:hash(binding),nonce,verifier,expires:this.now()+300000});const url=new URL(this.config.authorizationEndpoint);url.search=new URLSearchParams({client_id:this.config.clientId,response_type:'code',scope:'openid',redirect_uri:this.origin+'/auth/callback',state,nonce,code_challenge:hash(verifier),code_challenge_method:'S256'}).toString();return {location:url.href,cookie:setCookie(TRANSACTION,binding,300)};}
 async finish(query:URLSearchParams,header:string|undefined){
  this.prune();const state=query.get('state')??'',tx=this.pending.get(state);this.pending.delete(state);
  if(!tx||query.getAll('state').length!==1||query.getAll('code').length!==1||query.has('error')||!query.get('code')||query.get('code')!.length>4096||hash(cookie(header,TRANSACTION)??'')!==tx.binding)throw Error('Invalid login transaction');
  const result=await this.exchange(this.config.tokenEndpoint,new URLSearchParams({grant_type:'authorization_code',code:query.get('code')!,client_id:this.config.clientId,redirect_uri:this.origin+'/auth/callback',code_verifier:tx.verifier}));
  if(tx.expires<=this.now())throw Error('Login transaction expired');
  if(!result||typeof result!=='object'||!('id_token'in result)||typeof result.id_token!=='string'||result.id_token.length>16384)throw Error('Missing identity token');
  const {payload}=await jwtVerify(result.id_token,this.keys,{issuer:this.config.issuer,audience:this.config.clientId,algorithms:['RS256'],requiredClaims:['exp','iat','sub','nonce'],currentDate:new Date(this.now()),maxTokenAge:300});
  if(payload.nonce!==tx.nonce||payload.azp!==undefined&&payload.azp!==this.config.clientId||Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==this.config.clientId)throw Error('Identity claims rejected');
  const member=this.config.members.find(m=>m.issuerSubject===payload.sub);if(!member)throw Error('Identity is not enrolled');
  this.prune();if(this.sessions.size>=100)throw Error('Session capacity exceeded');
  this.revoke(header);const raw=random(),identity={subject:member.subject,tenant:member.tenant};
  const expires=Math.min(this.now()+1800000,payload.exp!*1000);this.sessions.set(hash(raw),{identity,csrf:random(),expires,last:this.now(),closed:new Set()});
  return {identity,cookies:[setCookie(SESSION,raw,Math.floor((expires-this.now())/1000)),setCookie(TRANSACTION,'',0)]};
 }
 session(header:string|undefined){this.prune();const raw=cookie(header,SESSION);const session=raw?this.sessions.get(hash(raw)):undefined;if(session)session.last=this.now();return session;}
 revoke(header:string|undefined){const raw=cookie(header,SESSION);if(raw){const session=this.sessions.get(hash(raw));this.sessions.delete(hash(raw));for(const close of session?.closed??[])close();}return setCookie(SESSION,'',0);}
 clearTransaction(){return setCookie(TRANSACTION,'',0);}
 watch(header:string|undefined,close:()=>void){
  const raw=cookie(header,SESSION),session=raw?this.sessions.get(hash(raw)):undefined;
  if(!session){close();return ()=>{};}
  const timer=setInterval(()=>this.prune(),1000);timer.unref();
  const end=()=>{clearInterval(timer);session.closed.delete(end);close();};session.closed.add(end);
  return ()=>{clearInterval(timer);session.closed.delete(end);};
 }
 clear(){for(const session of this.sessions.values())for(const close of session.closed)close();this.sessions.clear();this.pending.clear();}
}
