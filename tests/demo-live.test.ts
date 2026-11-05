import test from 'node:test';
import assert from 'node:assert/strict';
import {demoLive,runDemoCommand} from '../scripts/demo-live.ts';
import type {DemoCommand,DemoRunner} from '../scripts/demo-live.ts';
const ready=(c:DemoCommand)=>c.args.includes('auth')?{code:0,stdout:'{"loggedIn":true,"authMethod":"claude.ai"}',stderr:''}:{code:0,stdout:'Logged in using ChatGPT',stderr:''};
const ok={code:0,stdout:'',stderr:''};
const isStatus=(c:DemoCommand)=>c.args.includes('status');
const isLogin=(c:DemoCommand)=>!isStatus(c)&&(c.args.includes('login'));
const isServer=(c:DemoCommand)=>c.args.includes('scripts/start-real.ts');
const opts={npmPath:'/path with spaces/npm-cli.js',nodeVersion:'22.16.0',log:()=>{}};
test('one command installs pinned deps, reuses both subscriptions, and starts only the guarded UI',async()=>{
 const calls:DemoCommand[]=[];await demoLive([],{...opts,run:async c=>{calls.push(c);return isStatus(c)?ready(c):ok;}});
 assert.equal(calls.length,4);assert.equal(calls[0].file,process.execPath);assert.deepEqual(calls[0].args,[opts.npmPath,'ci','--include=dev','--include=optional']);
 assert.equal(calls.filter(isLogin).length,0);assert.ok(calls[1].args.includes('forced_login_method="chatgpt"'));assert.ok(calls[2].args.includes('{"forceLoginMethod":"claudeai"}'));
 assert.deepEqual(calls[3].args,['--experimental-strip-types','scripts/start-real.ts','--enable-inference']);
 assert.ok(calls.every(c=>!c.args.includes('exec')&&!c.args.includes('--prompt')));
});
test('missing or API-based login opens fixed subscription login then rechecks before serving',async()=>{
 const calls:DemoCommand[]=[],counts=new Map<string,number>();
 await demoLive([],{...opts,run:async c=>{calls.push(c);if(!isStatus(c))return ok;const key=c.args.includes('auth')?'claude':'codex';const n=counts.get(key)??0;counts.set(key,n+1);return n?ready(c):{code:0,stdout:key==='claude'?'{"loggedIn":true,"authMethod":"api_key"}':'Logged in using API key',stderr:''};}});
 assert.equal(calls.filter(isLogin).length,2);assert.ok(calls.find(c=>isLogin(c)&&c.args.includes('auth'))?.args.includes('--claudeai'));assert.ok(isServer(calls.at(-1)!));
});
for(const failure of ['install','login','recheck','status-error','server'] as const)test(`failure at ${failure} stops without fallback or retry`,async()=>{
 const calls:DemoCommand[]=[];
 const run:DemoRunner=async c=>{calls.push(c);if(c.args.includes('ci'))return failure==='install'?{...ok,code:1}:ok;if(isServer(c))return {...ok,code:1};if(isStatus(c)){if(failure==='status-error')throw Error('Auth unavailable');return failure==='server'?ready(c):{...ok,code:1};}return failure==='login'?{...ok,code:1}:ok;};
 await assert.rejects(demoLive([],{...opts,run}));assert.equal(calls.filter(isServer).length,failure==='server'?1:0);
});
test('help, unsupported Node, invalid args and pre-abort never install or authenticate',async()=>{
 let calls=0;const run:DemoRunner=async()=>{calls++;return ok;};
 await demoLive(['--help'],{...opts,run});
 await assert.rejects(demoLive([],{...opts,run,nodeVersion:'22.10.0'}));await assert.rejects(demoLive(['--api-key'],{...opts,run}));
 await assert.rejects(demoLive([],{...opts,run,signal:AbortSignal.abort()}));assert.equal(calls,0);
});
test('cancellation between login and server prevents inference startup',async()=>{
 const controller=new AbortController();let servers=0;
 await assert.rejects(demoLive([],{...opts,signal:controller.signal,run:async c=>{if(isServer(c))servers++;if(c.args.includes('auth'))controller.abort();return isStatus(c)?ready(c):ok;}}));assert.equal(servers,0);
});
test('subprocess environment strips API routing and live flags; output and time are bounded',async()=>{
 const old={...process.env};Object.assign(process.env,{OPENAI_API_KEY:'synthetic',ANTHROPIC_API_KEY:'synthetic',ANTHROPIC_BASE_URL:'https://example.invalid',NODE_OPTIONS:'',KOINOUS_ENABLE_INFERENCE:'1',GROK_BUILD_ENABLE_INFERENCE:'1'});
 try{
 const result=await runDemoCommand({file:process.execPath,args:['-e','console.log(JSON.stringify({key:process.env.OPENAI_API_KEY,claude:process.env.ANTHROPIC_API_KEY,url:process.env.ANTHROPIC_BASE_URL,live:process.env.KOINOUS_ENABLE_INFERENCE,grok:process.env.GROK_BUILD_ENABLE_INFERENCE,disabled:process.env.KOINOUS_DISABLED_PROVIDERS}))'],capture:true,timeoutMs:3000},new AbortController().signal);
 assert.deepEqual(JSON.parse(result.stdout),{live:'0',grok:'0',disabled:'grok'});
 await assert.rejects(runDemoCommand({file:process.execPath,args:['-e','process.stdout.write("x".repeat(70000))'],capture:true,timeoutMs:3000},new AbortController().signal));
 await assert.rejects(runDemoCommand({file:process.execPath,args:['-e','setInterval(()=>{},1000)'],capture:true,timeoutMs:50},new AbortController().signal));
 }finally{for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
test('web-search key is forwarded only to the server purpose, never install/auth commands',async()=>{
 const before=process.env.BRAVE_SEARCH_API_KEY;process.env.BRAVE_SEARCH_API_KEY='synthetic-search-key';
 try{for(const purpose of [undefined,'server'] as const){
  const result=await runDemoCommand({file:process.execPath,args:['-e','console.log(JSON.stringify({search:process.env.BRAVE_SEARCH_API_KEY,model:process.env.OPENAI_API_KEY}))'],capture:true,timeoutMs:3000,...(purpose?{purpose}:{})},new AbortController().signal);
  assert.deepEqual(JSON.parse(result.stdout),purpose?{search:'synthetic-search-key'}:{});
 }}finally{if(before===undefined)delete process.env.BRAVE_SEARCH_API_KEY;else process.env.BRAVE_SEARCH_API_KEY=before;}
});

test('OpenAI-only launch authenticates only Codex and passes mode to guarded startup',async()=>{
 const calls:DemoCommand[]=[];let status=0;
 await demoLive(['--openai-only'],{...opts,run:async c=>{calls.push(c);if(isStatus(c))return status++?ready(c):{...ok,code:1};return ok;}});
 assert.equal(calls.filter(isLogin).length,1);assert.equal(calls.filter(isStatus).length,2);
 assert.ok(calls.every(c=>!c.args.includes('auth')&&!c.file.includes('anthropic')));
 assert.deepEqual(calls.at(-1)?.args,['--experimental-strip-types','scripts/start-real.ts','--enable-inference','--openai-only']);
});
