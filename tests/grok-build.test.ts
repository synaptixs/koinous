import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {buildProtocol,buildEnvironment,GrokBuildAdapter,launchBuild} from '../src/grok-build.ts';
import {createAdapters,MockAdapter} from '../src/adapters.ts';

function fake(options:{auth?:boolean;stop?:string;empty?:boolean;tool?:boolean;error?:boolean;hang?:boolean}={}){
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),killed:false,kill(){this.killed=true;return true;}});
  const requests:any[]=[];
  const send=(m:unknown)=>child.stdout.write(JSON.stringify(m)+'\n');
  child.stdin.on('data',(chunk:Buffer)=>{
    const m=JSON.parse(chunk.toString());requests.push(m);
    if(!m.method || options.hang)return;
    queueMicrotask(()=>{
      if(options.error){send({jsonrpc:'2.0',id:m.id,error:{message:'SECRET'}});return;}
      let result:unknown={};
      if(m.method==='initialize')result={protocolVersion:1,authMethods:options.auth===false?[{id:'xai.api_key'}]:[{id:'cached_token'},{id:'xai.api_key'}]};
      if(m.method==='session/new')result={sessionId:'s1'};
      if(m.method==='session/prompt'){
        if(options.tool){send({jsonrpc:'2.0',id:99,method:'session/request_permission',params:{}});return;}
        send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'other',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'WRONG SESSION'}}}});
        send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'HIDDEN'}}}});
        if(!options.empty)send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'s1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Visible answer.'}}}});
        result={stopReason:options.stop||'end_turn'};
      }
      send({jsonrpc:'2.0',id:m.id,result});
    });
  });
  return {child:child as unknown as ChildProcessWithoutNullStreams,requests};
}
const signal=()=>new AbortController().signal;
test('Build preflight only initializes and authenticates cached browser token',async()=>{
  const f=fake();const r=await buildProtocol(f.child,'/isolated',signal());
  assert.deepEqual(f.requests.map(m=>m.method),['initialize','authenticate']);
  assert.equal(f.requests[1].params.methodId,'cached_token');assert.equal(r.usage?.usd,null);assert.ok(f.child.killed);
});
test('Build public answer omits thoughts and other sessions, keeps accounting unknown',async()=>{
  const f=fake();const r=await buildProtocol(f.child,'/isolated',signal(),'synthetic prompt');
  assert.equal(r.text,'Visible answer.');assert.deepEqual(r.usage,{usd:null});
  assert.deepEqual(f.requests[0].params.clientCapabilities,{fs:{readTextFile:false,writeTextFile:false},terminal:false});
  assert.deepEqual(f.requests[2].params,{cwd:'/isolated',mcpServers:[]});assert.equal(f.requests.filter(m=>m.method==='session/prompt').length,1);
});
test('Build never falls back to an API auth method',async()=>{
  const f=fake({auth:false});await assert.rejects(buildProtocol(f.child,'/isolated',signal(),'q'),{code:'authentication'});
  assert.equal(f.requests.length,1);assert.ok(f.child.killed);
});
test('Build rejects tool requests and sends cancelled permission',async()=>{
  const f=fake({tool:true});await assert.rejects(buildProtocol(f.child,'/isolated',signal(),'q'),{code:'tool_denied'});
  assert.deepEqual(f.requests.at(-1).result,{outcome:{outcome:'cancelled'}});assert.ok(f.child.killed);
});
test('Build rejects truncation and empty responses',async()=>{
  for(const opts of [{stop:'max_tokens'},{empty:true}]){
    const f=fake(opts);await assert.rejects(buildProtocol(f.child,'/isolated',signal(),'q'));assert.ok(f.child.killed);
  }
});
test('Build scrubs arbitrary provider error messages',async()=>{
  const f=fake({error:true});await assert.rejects(buildProtocol(f.child,'/isolated',signal(),'q'),(e:Error)=>!e.message.includes('SECRET'));assert.ok(f.child.killed);
});
test('Build cancellation and process exit reject pending work',async()=>{
  const f=fake({hang:true}),c=new AbortController();const p=buildProtocol(f.child,'/isolated',c.signal,'q');c.abort();await assert.rejects(p,{code:'cancelled'});assert.ok(f.child.killed);
  const g=fake({hang:true});const q=buildProtocol(g.child,'/isolated',signal(),'q');g.child.emit('close',1);await assert.rejects(q,{code:'provider_error'});
});
test('Build bounds and validates protocol output',async()=>{
  for(const output of ['not json\n','x'.repeat(2*1024*1024+1)]){
    const f=fake({hang:true});const p=buildProtocol(f.child,'/isolated',signal(),'q');f.child.stdout.emit('data',Buffer.from(output));await assert.rejects(p);assert.ok(f.child.killed);
  }
});
test('Build child environment excludes credentials and endpoint overrides',()=>{
  process.env.XAI_API_KEY='sentinel';process.env.GROK_MODELS_BASE_URL='https://untrusted.invalid';
  try{const e=buildEnvironment('/isolated');assert.equal(e.XAI_API_KEY,undefined);assert.equal(e.GROK_MODELS_BASE_URL,undefined);assert.equal(e.GROK_HOME,'/isolated');assert.equal(e.GROK_CLAUDE_HOOKS_ENABLED,'0');}
  finally{delete process.env.XAI_API_KEY;delete process.env.GROK_MODELS_BASE_URL;}
});
test('Build requires explicit inference opt-in and factory selection never falls back',async()=>{
  const old=process.env.GROK_TRANSPORT,enable=process.env.GROK_BUILD_ENABLE_INFERENCE;
  try{
    process.env.GROK_TRANSPORT='api';assert.throws(()=>createAdapters('real'),/API-key fallback is disabled/);
    delete process.env.GROK_TRANSPORT;assert.ok(createAdapters('real')[2] instanceof GrokBuildAdapter);
    process.env.GROK_TRANSPORT='build';assert.ok(createAdapters('real')[2] instanceof GrokBuildAdapter);
    delete process.env.GROK_BUILD_ENABLE_INFERENCE;await assert.rejects(createAdapters('real')[2].run('q',1,signal()),{code:'configuration'});
    process.env.GROK_TRANSPORT='typo';assert.throws(()=>createAdapters('real'));assert.ok(createAdapters('mock')[2] instanceof MockAdapter);
  }finally{if(old===undefined)delete process.env.GROK_TRANSPORT;else process.env.GROK_TRANSPORT=old;if(enable===undefined)delete process.env.GROK_BUILD_ENABLE_INFERENCE;else process.env.GROK_BUILD_ENABLE_INFERENCE=enable;}
});

test('Build missing dependency fails before spawning, without API fallback',async()=>{
  const binary=process.env.GROK_BUILD_BINARY,home=process.env.GROK_BUILD_AUTH_HOME;
  let spawned=false;
  try {
    process.env.GROK_BUILD_BINARY='/nonexistent-koinous-grok-binary';process.env.GROK_BUILD_AUTH_HOME='/nonexistent-koinous-auth-home';
    await assert.rejects(launchBuild(signal(),undefined,()=>{spawned=true;return fake().child;}),{code:'configuration'});
    assert.equal(spawned,false);
  } finally {
    if(binary===undefined)delete process.env.GROK_BUILD_BINARY;else process.env.GROK_BUILD_BINARY=binary;
    if(home===undefined)delete process.env.GROK_BUILD_AUTH_HOME;else process.env.GROK_BUILD_AUTH_HOME=home;
  }
});

test('Build socket sandbox failure is specific, sanitized, and never retries',async()=>{
  const f=fake({hang:true});const p=buildProtocol(f.child,'/isolated',signal());
  f.child.stderr.emit('data',Buffer.from('warning: socket deny resolu'));
  f.child.stderr.emit('data',Buffer.from('tion failed: private/path SECRET'));
  f.child.emit('close',1);
  await assert.rejects(p,(e:any)=>e.code==='sandbox_incompatible' && !e.message.includes('SECRET') && !e.message.includes('private/path'));
  assert.deepEqual(f.requests.map(m=>m.method),['initialize']);assert.ok(f.child.killed);
});
