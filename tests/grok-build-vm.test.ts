import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {launchBuild} from '../src/grok-build.ts';
import {spawnIsolatedBuild} from '../src/grok-build-vm.ts';

async function configured(work:(home:string)=>Promise<void>){
  const home=mkdtempSync(join(tmpdir(),'koinous-vm-test-'));
  const values={GROK_BUILD_RUNTIME:'vm',GROK_BUILD_PODMAN:'/fixture/podman',GROK_BUILD_VM:'koinous-grok-test',GROK_BUILD_AUTH_HOME:home};
  const old={...process.env};Object.assign(process.env,values);
  writeFileSync(join(home,'auth.json'),'{"token":"offline-sentinel"}',{mode:0o600});
  try{await work(home);}finally{for(const key of Object.keys(values)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}rmSync(home,{recursive:true,force:true});}
}
function transport(mode='success'){
  const requests:any[]=[];
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){queueMicrotask(()=>child.emit('close',137));return true;}});
  child.stdin.on('data',(b:Buffer)=>{
    const m=JSON.parse(b.toString());requests.push(m);
    if(!m.method || mode==='hang')return;
    queueMicrotask(()=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...(mode==='reject'?{error:{message:'secret'}}:{result:m.method==='initialize'?{protocolVersion:1,authMethods:[{id:'grok.com'}]}:{}})})+'\n'));
  });
  child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('close',mode==='cleanup-fails'?1:0)));
  return {child:child as unknown as ChildProcessWithoutNullStreams,requests};
}
test('VM preflight authenticates only; credentials travel on stdin, cleanup waits for EOF',async()=>configured(async()=>{
  const f=transport();
  const result=await launchBuild(new AbortController().signal,undefined,o=>{
    assert.equal(o.binary,'/fixture/podman');assert.deepEqual(o.args.slice(0,3),['machine','ssh','koinous-grok-test']);
    assert.ok(!JSON.stringify(o).includes('offline-sentinel'));assert.equal(o.env.CONTAINERS_MACHINE_PROVIDER,'applehv');assert.equal(o.env.XAI_API_KEY,undefined);
    return f.child;
  });
  assert.deepEqual(f.requests.slice(1).map(x=>x.method),['initialize','authenticate']);
  assert.equal(f.requests[2].params.methodId,'grok.com');assert.equal(f.requests[0].timeoutMs,30000);assert.equal(result.usage?.usd,null);assert.ok(f.child.stdin.writableEnded);
}));
test('VM cancellation, protocol rejection and unsuccessful teardown fail closed',async()=>configured(async()=>{
  for(const mode of ['hang','reject','cleanup-fails']){
    const f=transport(mode),c=new AbortController();const p=launchBuild(c.signal,undefined,()=>f.child);
    if(mode==='hang')c.abort();
    await assert.rejects(p);assert.ok(f.child.stdin.writableEnded);
    assert.ok(!f.requests.some(x=>x.method==='session/new'));
  }
}));
test('VM invalid destination and missing credential never launch a subprocess',async()=>configured(async home=>{
  let launches=0;const start=()=>{launches++;return transport().child;};
  process.env.GROK_BUILD_VM='other-vm; echo unsafe';assert.throws(()=>spawnIsolatedBuild('model',30000,start));
  process.env.GROK_BUILD_VM='koinous-grok-test';rmSync(join(home,'auth.json'));assert.throws(()=>spawnIsolatedBuild('model',30000,start));assert.equal(launches,0);
}));
test('unknown runtime cannot fall back to native or API',async()=>configured(async()=>{
  process.env.GROK_BUILD_RUNTIME='typo';await assert.rejects(launchBuild(new AbortController().signal),{code:'configuration'});
}));

test('explicit Grok model reaches isolated transport without global environment mutation',async()=>configured(async()=>{
 const original=process.env.GROK_BUILD_MODEL;
 const a=transport(),b=transport();
 const replies=await Promise.all([
  launchBuild(new AbortController().signal,undefined,()=>a.child,'grok-model-a'),
  launchBuild(new AbortController().signal,undefined,()=>b.child,'grok-model-b')
 ]);
 assert.equal(a.requests[0].model,'grok-model-a');assert.equal(b.requests[0].model,'grok-model-b');
 assert.deepEqual(replies.map(r=>r.requestedModel),['grok-model-a','grok-model-b']);assert.equal(process.env.GROK_BUILD_MODEL,original);
}));

test('managed connection overrides ambient VM settings without mutating environment',async()=>configured(async home=>{
 const f=transport();const before=process.env.GROK_BUILD_VM;
 await launchBuild(new AbortController().signal,undefined,o=>{
  assert.equal(o.binary,'/managed/podman');assert.equal(o.args[2],'koinous-grok-owned');return f.child;
 },'explicit-model',{podman:'/managed/podman',vm:'koinous-grok-owned',authHome:home});
 assert.equal(process.env.GROK_BUILD_VM,before);assert.equal(f.requests[0].model,'explicit-model');
 assert.deepEqual(f.requests.slice(1).map(x=>x.method),['initialize','authenticate']);
}));

test('restricted egress is explicit stdin-only connection policy and empty stays deny-all',async()=>configured(async home=>{
 const f=transport();const connection={podman:'/fixture/podman',vm:'koinous-grok-test',authHome:home,egressHosts:['approved.example']};
 await launchBuild(new AbortController().signal,undefined,o=>{assert.ok(!o.args.join(' ').includes('approved.example'));return f.child;},'explicit-model',connection);
 assert.equal(f.requests[0].networkPolicy,'restricted');assert.deepEqual(f.requests[0].egressHosts,['approved.example']);
 const denied=transport();await launchBuild(new AbortController().signal,undefined,()=>denied.child,'explicit-model',{...connection,egressHosts:[]});
 assert.equal(denied.requests[0].networkPolicy,'deny-all');assert.deepEqual(denied.requests[0].egressHosts,[]);
}));
test('invalid egress policy refuses before credential read or subprocess launch',async()=>configured(async home=>{
 rmSync(join(home,'auth.json'));let launches=0;
 assert.throws(()=>spawnIsolatedBuild('model',30000,()=>{launches++;return transport().child;},{podman:'/fixture/podman',vm:'koinous-grok-test',authHome:home,egressHosts:['*.example']}),/egress hosts/);
 assert.equal(launches,0);
}));
