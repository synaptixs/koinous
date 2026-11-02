import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {WorkerProfiles,workerEnvironment} from '../src/worker-profiles.ts';
import {ProfileWorkers} from '../src/profile-worker.ts';
const alice={tenant:'alpha',subject:'alice'},bob={tenant:'alpha',subject:'bob'},other={tenant:'beta',subject:'alice'};
function fixture(t:test.TestContext){
 const root=mkdtempSync(join(tmpdir(),'koinous-profiles-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const entries=[...['codex','claude','grok'].map(provider=>({...alice,provider})),{...bob,provider:'codex'},{...other,provider:'codex'}];
 const profiles=new WorkerProfiles(root,entries,[alice,bob,other]);return {root,profiles,entries};
}
test('profile ownership is per tenant, subject and provider, with no request path override',t=>{
 const f=fixture(t),a=f.profiles.resolve(alice,'codex')!,b=f.profiles.resolve(bob,'codex')!,c=f.profiles.resolve(other,'codex')!;
 assert.equal(new Set([a.home,b.home,c.home]).size,3);assert.equal(f.profiles.resolve({tenant:'beta',subject:'bob'},'codex'),undefined);
 assert.equal(f.profiles.resolve(alice,'../codex'),undefined);assert.equal(f.profiles.list(bob).length,1);
 assert.ok(!JSON.stringify(f.profiles.list(alice)).includes(f.root));
 assert.throws(()=>new WorkerProfiles(f.root,[{...alice,provider:'codex',home:'/tmp/override'}],[alice]));
 assert.throws(()=>new WorkerProfiles(f.root,[{...alice,provider:'codex'},{...alice,provider:'codex'}],[alice]));
 assert.throws(()=>new WorkerProfiles(f.root,[{...alice,provider:'codex'}],[bob]));
});
test('profile environment never inherits keys, host homes, SDK settings or code injection',t=>{
 const f=fixture(t);for(const provider of ['codex','claude','grok']){
  const p=f.profiles.resolve(alice,provider)!,env=workerEnvironment(p);assert.equal(env.HOME,p.home);
  assert.equal(env.KOINOUS_ENABLE_INFERENCE,'0');assert.equal(env.GROK_BUILD_ENABLE_INFERENCE,'0');
  for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','XAI_API_KEY','NODE_OPTIONS','PATH','SSH_AUTH_SOCK','HTTP_PROXY'])assert.equal(env[key],undefined);
  assert.equal(Object.keys(env).filter(k=>['CODEX_HOME','CLAUDE_CONFIG_DIR','GROK_BUILD_AUTH_HOME'].includes(k)).length,1);
 }
});
test('owner tampering, permissive directories and symlink credential namespaces are rejected',t=>{
 const f=fixture(t),p=f.profiles.resolve(alice,'codex')!;const owner=join(p.root,'owner.json');
 const original=readFileSync(owner);writeFileSync(owner,JSON.stringify({version:1,...bob,provider:'codex'}));assert.throws(()=>f.profiles.resolve(alice,'codex'),/ownership/);writeFileSync(owner,original);
 chmodSync(p.home,0o755);assert.throws(()=>f.profiles.resolve(alice,'codex'),/unsafe/);chmodSync(p.home,0o700);
 rmSync(p.login,{recursive:true});symlinkSync(f.profiles.resolve(bob,'codex')!.login,p.login);assert.throws(()=>f.profiles.resolve(alice,'codex'),/unsafe/);
});
test('actual restricted workers inspect all three providers without reading credentials or accessing other profiles',async t=>{
 const f=fixture(t),workers=new ProfileWorkers();
 try{for(const provider of ['codex','claude','grok']){
  const p=f.profiles.resolve(alice,provider)!;writeFileSync(join(p.login,provider==='claude'?'.credentials.json':'auth.json'),'SYNTHETIC_NOT_A_LOGIN',{mode:0o600});
  const result=await workers.inspect(p,new AbortController().signal) as any;
  assert.equal(result.credentialFilePresent,true);assert.equal(result.authenticationVerified,false);assert.equal(result.inferenceEnabled,false);
  assert.ok(Object.values(result.checks).every(v=>v===true));assert.ok(!JSON.stringify(result).includes('SYNTHETIC'));assert.ok(!JSON.stringify(result).includes(f.root));
 }}finally{await workers.shutdown();}
});
test('missing credentials stay missing and unsafe credential files fail preflight',async t=>{
 const f=fixture(t),p=f.profiles.resolve(alice,'codex')!,workers=new ProfileWorkers();
 try{const result=await workers.inspect(p,new AbortController().signal) as any;assert.equal(result.credentialFilePresent,false);
  const file=join(p.login,'auth.json');symlinkSync(join(f.profiles.resolve(bob,'codex')!.login,'auth.json'),file);
  await assert.rejects(workers.inspect(p,new AbortController().signal),/preflight failed/);
 }finally{await workers.shutdown();}
});
test('worker cancellation, timeout, per-profile locking and shutdown await process exit',async t=>{
 const f=fixture(t),p=f.profiles.resolve(alice,'codex')!,workers=new ProfileWorkers();
 const controller=new AbortController();const first=workers.inspect(p,controller.signal);const failed=assert.rejects(first,/preflight failed/);
 await assert.rejects(workers.inspect(p,new AbortController().signal),/capacity/);controller.abort();await failed;
 await assert.rejects(workers.inspect(p,new AbortController().signal,1),/preflight failed/);
 const running=workers.inspect(p,new AbortController().signal);const killed=assert.rejects(running,/preflight failed/);await workers.shutdown();await killed;
 await assert.rejects(workers.inspect(p,new AbortController().signal),/unavailable/);
});


test('worker protocol rejects prompts and inference commands rather than loading a provider',t=>{
 const f=fixture(t),p=f.profiles.resolve(alice,'codex')!,script=fileURLToPath(new URL('../scripts/runtime/profile-worker.mjs',import.meta.url));
 for(const input of [{kind:'run',provider:'codex',root:p.root},{kind:'inspect',provider:'codex',root:p.root,prompt:'Never infer'}]){
  const result=spawnSync(process.execPath,['--permission',`--allow-fs-read=${p.root}`,`--allow-fs-read=${script}`,script],{env:workerEnvironment(p),cwd:p.workspace,input:JSON.stringify(input),encoding:'utf8'});
  assert.equal(result.status,1);assert.deepEqual(JSON.parse(result.stdout),{ok:false,error:'worker_preflight_failed'});
 }
});


test('concurrent profiles use independent processes/environments without mutating parent HOME',async t=>{
 const f=fixture(t),workers=new ProfileWorkers(),home=process.env.HOME;
 const a=f.profiles.resolve(alice,'codex')!,b=f.profiles.resolve(bob,'codex')!;
 writeFileSync(join(a.login,'auth.json'),'SYNTHETIC_ONLY',{mode:0o600});
 try{const results=await Promise.all([workers.inspect(a,new AbortController().signal),workers.inspect(b,new AbortController().signal)]) as any[];
  assert.equal(results[0].credentialFilePresent,true);assert.equal(results[1].credentialFilePresent,false);assert.equal(process.env.HOME,home);
 }finally{await workers.shutdown();}
});
