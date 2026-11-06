import test from 'node:test';
import assert from 'node:assert/strict';
import {authCommand,subscriptionReady,setup,checkSubscriptions} from '../src/subscription-setup.ts';
import type {AuthRunner,AuthResult} from '../src/subscription-setup.ts';
import {preparePersonalDiscussion} from '../scripts/start-real.ts';
import type {IncomingMessage,ServerResponse} from 'node:http';
const ok=(stdout:string,stderr=''):AuthResult=>({code:0,stdout,stderr});
const ready:AuthRunner=async p=>p==='codex'?ok('','Logged in using ChatGPT\n'):ok(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));
test('setup help is offline, fixed login commands cannot accept API options or prompts',async()=>{
 let calls=0;const run:AuthRunner=async()=>{calls++;return ok('');};
 assert.match(await setup([],run),/npm run setup -- login codex/);assert.equal(calls,0);
 for(const args of [['login','grok'],['login','codex','--with-api-key'],['exec','prompt'],['status','--json']])await assert.rejects(setup(args,run));
 assert.equal(calls,0);
 const codex=authCommand('codex','login');assert.ok(codex.args.includes('forced_login_method="chatgpt"'));assert.equal(codex.args.at(-1),'login');assert.ok(!codex.args.includes('--with-api-key'));
 for(const platform of ['darwin','linux','win32'] as const){const c=authCommand('claude','login',platform,'arm64');assert.ok(c.args.includes('--claudeai'));assert.ok(c.args.includes('{"forceLoginMethod":"claudeai"}'));assert.ok(!c.args.includes('--console'));}
});
test('setup explicitly includes enterprise provider accounts while workspace and entitlement remain unverified',async()=>{
 const help=await setup([],async()=>{throw Error('Help must not authenticate');});assert.match(help,/personal or enterprise/);assert.match(help,/SSO/);
 const status=await setup(['status'],ready);assert.match(status,/personal or enterprise/);assert.match(status,/does not verify.*enterprise workspace/);
 assert.equal(subscriptionReady('claude',ok(JSON.stringify({loggedIn:true,authMethod:'claude.ai',organizationType:'enterprise'}))),true);
});
test('status accepts only confirmed subscriptions and never echoes provider output',async()=>{
 assert.equal(subscriptionReady('codex',ok('','Logged in using ChatGPT\n')),true);
 for(const value of ['Logged in using an API key','Logged in using ChatGPT\nSECRET','unknown',''])assert.equal(subscriptionReady('codex',ok(value)),false);
 for(const method of ['api_key','api_key_helper','oauth_token','third_party','none'])assert.equal(subscriptionReady('claude',ok(JSON.stringify({loggedIn:true,authMethod:method}))),false);
 assert.equal(subscriptionReady('claude',ok('{broken')),false);assert.equal(subscriptionReady('claude',{code:1,stdout:'{}',stderr:''}),false);
 assert.deepEqual(await checkSubscriptions(ready),{codex:true,claude:true});
 const text=await setup(['status'],async()=>ok('SECRET'));assert.doesNotMatch(text,/SECRET/);assert.match(text,/not confirmed/);
});
test('login is explicit and a failure never falls back or starts a model',async()=>{
 const calls:string[]=[];const run:AuthRunner=async(p,a)=>{calls.push(p+':'+a);return ok('');};
 assert.match(await setup(['login','claude'],run),/Inference remains disabled/);assert.deepEqual(calls,['claude:login']);
 await assert.rejects(setup(['login','codex'],async()=>({code:1,stdout:'',stderr:'secret'})),/no API-key fallback/);
});
test('real startup requires explicit opt-in and at least one subscription; Grok and inherited live flags cannot bypass it',async t=>{
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);});
 Object.assign(process.env,{KOINOUS_ENABLE_INFERENCE:'1',GROK_BUILD_ENABLE_INFERENCE:'1',KOINOUS_PROVIDERS:'grok'});
 let calls=0;const never:AuthRunner=async()=>{calls++;throw Error('unexpected');};
 await assert.rejects(preparePersonalDiscussion([],never),/disabled/);assert.equal(calls,0);assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'0');
 await assert.rejects(preparePersonalDiscussion(['--enable-inference'],async()=>ok('API key'),()=>{}),/No OpenAI\/Claude provider account/);assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'0');
 const app=await preparePersonalDiscussion(['--enable-inference'],ready);
 assert.equal(app.mode,'real');assert.equal(process.env.KOINOUS_PROVIDERS,'codex,claude');assert.equal(process.env.KOINOUS_DISABLED_PROVIDERS,'grok');assert.equal(process.env.GROK_BUILD_ENABLE_INFERENCE,'0');assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'1');
 assert.equal(app.engine.sessions.size,0);await app.shutdown();
});

for(const available of ['codex','claude'] as const)for(const failure of ['missing-cli','signed-out','api-key'] as const)test(`startup skips ${available==='codex'?'Claude':'Codex'} (${failure}) and exposes only usable account choices`,async t=>{
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);});
 const calls:string[]=[],logs:string[]=[],missing=available==='codex'?'claude':'codex';
 const app=await preparePersonalDiscussion(['--enable-inference'],async(p,a)=>{
  calls.push(p+':'+a);assert.equal(a,'status');assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'0');
  if(p===available)return ready(p,a);
  if(failure==='missing-cli')throw Error('SECRET missing binary');
  return failure==='signed-out'?{code:1,stdout:'SECRET',stderr:'SECRET'}:ok(p==='codex'?'Logged in using an API key':'{"loggedIn":true,"authMethod":"api_key"}');
 },s=>logs.push(s));t.after(()=>app.shutdown());
 assert.deepEqual(calls,['codex:status','claude:status']);assert.equal(process.env.KOINOUS_PROVIDERS,available);
 assert.equal(process.env.KOINOUS_DISABLED_PROVIDERS,missing+',grok');
 assert.match(logs.join('\n'),new RegExp(missing+': skipped'));assert.doesNotMatch(logs.join('\n'),/SECRET/);
 let status=0,payload='';
 const response={writeHead(code:number){status=code;},end(body:string){payload=body;}} as unknown as ServerResponse;
 await app.handler({method:'GET',url:'/api/health',headers:{}} as IncomingMessage,response);
 const health=JSON.parse(payload);assert.equal(status,200);
 assert.deepEqual(health.agents,[available,available+'-2']);
 assert.deepEqual(health.availableProviders.map((p:{id:string})=>p.id),[available,'ollama-local','ollama-cloud']);
 assert.deepEqual(health.availableParticipants.filter((p:{provider:string})=>p.provider===available).map((p:{defaultModel:string})=>p.defaultModel),['','']);
 assert.equal(health.inferenceEnabled,true);assert.equal(app.engine.sessions.size,0);
 await app.handler({method:'GET',url:'/api/models?provider='+missing,headers:{}} as IncomingMessage,response);
 assert.equal(status,400);assert.equal(app.engine.sessions.size,0);
});

test('status skips a thrown provider command and still reports the other account without exposing errors',async()=>{
 const calls:string[]=[];const text=await setup(['status'],async(p,a)=>{calls.push(p+':'+a);if(p==='codex')throw Error('SECRET timeout');return ready(p,a);});
 assert.deepEqual(calls,['codex:status','claude:status']);assert.match(text,/Codex.*not confirmed/);assert.match(text,/Claude.*ready/);assert.doesNotMatch(text,/SECRET/);
});

test('no available account stops after checking both providers, keeps inference off and offers explicit recovery',async t=>{
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);});
 const calls:string[]=[],logs:string[]=[];
 await assert.rejects(preparePersonalDiscussion(['--enable-inference'],async(p,a)=>{calls.push(p+':'+a);throw Error('SECRET unavailable');},s=>logs.push(s)),/No OpenAI\/Claude.*--ollama-only.*npm run demo/);
 assert.deepEqual(calls,['codex:status','claude:status']);assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'0');assert.equal(process.env.GROK_BUILD_ENABLE_INFERENCE,'0');assert.equal(logs.length,2);assert.doesNotMatch(logs.join('\n'),/SECRET/);
});

test('OpenAI-only startup requires Codex subscription, never checks Claude and fails closed on API login',async t=>{
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);});
 const args=['--enable-inference','--openai-only'];const calls:string[]=[];
 await assert.rejects(preparePersonalDiscussion(args,async()=>ok('Logged in using an API key')),/Codex account/);
 assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'0');
 const app=await preparePersonalDiscussion(args,async(p,a)=>{calls.push(p+':'+a);return ok('Logged in using ChatGPT');});
 assert.deepEqual(calls,['codex:status']);assert.equal(process.env.KOINOUS_DISABLED_PROVIDERS,'claude,grok,ollama-local,ollama-cloud');assert.equal(process.env.KOINOUS_PROVIDERS,'codex');assert.equal(app.engine.sessions.size,0);
 await app.shutdown();process.env.KOINOUS_ENABLE_INFERENCE='0';
});
