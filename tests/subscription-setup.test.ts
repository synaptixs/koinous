import test from 'node:test';
import assert from 'node:assert/strict';
import {authCommand,subscriptionReady,setup,checkSubscriptions} from '../src/subscription-setup.ts';
import type {AuthRunner,AuthResult} from '../src/subscription-setup.ts';
import {preparePersonalDiscussion} from '../scripts/start-real.ts';
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
test('real startup requires explicit opt-in and both subscription checks; Grok and inherited live flags cannot bypass it',async t=>{
 const before={...process.env};t.after(()=>{for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);});
 Object.assign(process.env,{KOINOUS_ENABLE_INFERENCE:'1',GROK_BUILD_ENABLE_INFERENCE:'1',KOINOUS_PROVIDERS:'grok'});
 let calls=0;const never:AuthRunner=async()=>{calls++;throw Error('unexpected');};
 await assert.rejects(preparePersonalDiscussion([],never),/disabled/);assert.equal(calls,0);assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'0');
 await assert.rejects(preparePersonalDiscussion(['--enable-inference'],async()=>ok('API key')),/Both subscription/);assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'0');
 const app=await preparePersonalDiscussion(['--enable-inference'],ready);
 assert.equal(app.mode,'real');assert.equal(process.env.KOINOUS_PROVIDERS,'codex,claude');assert.equal(process.env.KOINOUS_DISABLED_PROVIDERS,'grok');assert.equal(process.env.GROK_BUILD_ENABLE_INFERENCE,'0');assert.equal(process.env.KOINOUS_ENABLE_INFERENCE,'1');
 assert.equal(app.engine.sessions.size,0);await app.shutdown();
});
