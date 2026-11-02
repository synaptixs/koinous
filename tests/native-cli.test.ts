import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {WorkerProfiles} from '../src/worker-profiles.ts';import {SDKWorkers} from '../src/sdk-worker.ts';import {nativeCLICompatibility,CLI_PINS} from '../src/native-cli.ts';import {sdkBundle,executionSandbox,executionEnvironment} from '../src/sdk-execution.ts';
function fixture(t:test.TestContext){const root=realpathSync(mkdtempSync(join(tmpdir(),'koinous-native-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const owner={tenant:'synthetic',subject:'fixture'},profiles=new WorkerProfiles(root,['codex','claude'].map(provider=>({...owner,provider})),[owner]);return {root,profile:(id:string)=>profiles.resolve(owner,id)!};}
test('real pinned native CLIs pass version/help through the confined SDK worker without profile mutation',async t=>{
 const f=fixture(t),workers=new SDKWorkers();
 try{for(const provider of ['codex','claude'] as const){const p=f.profile(provider),file=join(p.login,provider==='codex'?'auth.json':'.credentials.json');writeFileSync(file,'SYNTHETIC_NOT_A_CREDENTIAL',{mode:0o600});const before=readdirSync(p.root,{recursive:true}).sort();
  const r=await workers.inspectNative(p,new AbortController().signal) as any;
  assert.equal(r.nativeCLI.cliVersion,CLI_PINS[provider]);assert.equal(r.nativeCLI.startupOnly,true);assert.equal(r.nativeCLI.versionCommandPassed,true);assert.equal(r.nativeCLI.helpCommandPassed,true);assert.equal(typeof r.nativeCLI.stderrObserved,'boolean');assert.equal(r.authenticationVerified,false);assert.equal(r.inferenceEnabled,false);
  assert.ok(!JSON.stringify(r).includes(f.root));assert.ok(!JSON.stringify(r).includes('SYNTHETIC'));assert.equal(readFileSync(file,'utf8'),'SYNTHETIC_NOT_A_CREDENTIAL');assert.deepEqual(readdirSync(p.root,{recursive:true}).sort(),before);
 }}finally{await workers.shutdown();}
});
test('native command selection is fixed and version/help failures cannot report compatibility',async()=>{
 for(const provider of ['codex','claude'] as const){const calls:string[][]=[];
  const r=await nativeCLICompatibility(provider,'/synthetic/cli',async(file,args)=>{assert.equal(file,'/synthetic/cli');calls.push([...args]);return {stdout:args[0]==='--version'?(provider==='codex'?'codex-cli 0.166.0':'2.1.316 (Claude Code)'):(provider==='codex'?'Usage: codex exec [OPTIONS]':'Usage: claude [options]'),stderrObserved:true};});
  assert.deepEqual(calls,[['--version'],provider==='codex'?['exec','--help']:['--help']]);assert.equal(r.stderrObserved,true);
 }
 let calls=0;await assert.rejects(nativeCLICompatibility('codex','/synthetic',async()=>{calls++;return {stdout:'codex-cli 0.165.0',stderrObserved:false};}),/version mismatch/);assert.equal(calls,1);
 calls=0;await assert.rejects(nativeCLICompatibility('claude','/synthetic',async()=>({stdout:++calls===1?'2.1.316 (Claude Code)':'unrelated output',stderrObserved:false})),/help contract/);
 await assert.rejects(nativeCLICompatibility('codex','/synthetic',async()=>{throw Error('Synthetic startup failure');}));
});
test('native-check protocol refuses prompts, argv, path and environment overrides',t=>{
 const f=fixture(t),p=f.profile('codex'),bundle=sdkBundle('codex'),s=executionSandbox(p,bundle);
 for(const extra of [{prompt:'never send'},{args:['login']},{cli:'/bin/sh'},{env:{OPENAI_API_KEY:'synthetic'}}]){
  const r=spawnSync(s.command,[...s.args,bundle.script],{input:JSON.stringify({kind:'native-check',provider:'codex',...extra}),env:executionEnvironment(p),cwd:p.workspace,encoding:'utf8',timeout:3000});assert.equal(r.status,1,r.stderr);assert.deepEqual(JSON.parse(r.stdout),{ok:false,error:'sdk_worker_failed'});
 }
});
test('native startup is bounded and cancellation/shutdown never enable inference',async t=>{
 const f=fixture(t),workers=new SDKWorkers(),controller=new AbortController();const pending=workers.inspectNative(f.profile('claude'),controller.signal),failed=assert.rejects(pending,/failed/);controller.abort();await failed;
 await assert.rejects(workers.inspectNative(f.profile('codex'),new AbortController().signal,1),/failed/);await assert.rejects(workers.run(f.profile('codex'),'never send'),/disabled/);await workers.shutdown();await assert.rejects(workers.inspectNative(f.profile('claude'),new AbortController().signal),/unavailable/);
});
