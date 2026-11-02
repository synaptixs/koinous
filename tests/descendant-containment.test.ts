import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {WorkerProfiles} from '../src/worker-profiles.ts';import {sdkBundle,executionSandbox,executionEnvironment} from '../src/sdk-execution.ts';import {confinedProcess} from '../src/confined-process.ts';
function fixture(t:test.TestContext){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'koinous-descendant-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const owner={tenant:'a',subject:'one'},profile=new WorkerProfiles(root,[{...owner,provider:'codex'}],[owner]).resolve(owner,'codex')!;
 const binary=join(root,'probe'),build=spawnSync('/usr/bin/clang',['-Wall','-Wextra','-Werror',resolve('tests/fixtures/descendant-probe.c'),'-o',binary],{encoding:'utf8',timeout:10000});assert.equal(build.status,0,build.stderr);
 const bundle={...sdkBundle('codex'),cli:binary};return {root,binary,profile,bundle};
}
test('native baseline can detach; kernel policy denies setsid/setpgid and all posix_spawn attribute routes',t=>{
 const f=fixture(t),baseline=spawnSync(f.binary,[],{encoding:'utf8',timeout:3000});assert.equal(baseline.status,0,baseline.stderr);assert.equal(baseline.stdout.trim(),'0 0 0 0 0');
 const s=executionSandbox(f.profile,f.bundle),r=spawnSync(s.command,[...s.args.slice(0,2),f.binary],{env:executionEnvironment(f.profile),cwd:f.profile.workspace,encoding:'utf8',timeout:3000});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'1 1 1 1 1');
});
test('SDK spawn shim works without permitting detached or identity-changing launches; kernel still constrains shim bypass',t=>{
 const f=fixture(t),script=join(f.root,'spawn.mjs');writeFileSync(script,`
import {spawn,spawnSync} from 'node:child_process';import {installConfinedSpawn} from ${JSON.stringify('file://'+resolve('src/confined-spawn.ts'))};
installConfinedSpawn();const file=process.argv[2];
const result=await new Promise((resolve,reject)=>{const child=spawn(file,['identity']);let out='';child.stdout.on('data',chunk=>out+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,out}));});
let detached=false,identity=false;try{spawn(file,[],{detached:true});}catch{detached=true;}try{spawn(file,[],{uid:process.getuid()+1});}catch{identity=true;}
const bypass=spawnSync(file,['identity'],{uid:process.getuid(),gid:process.getgid(),detached:true,encoding:'utf8'});
const raw=spawnSync(file,['identity']);console.log(JSON.stringify({result,detached,identity,bypass:bypass.stdout,raw:raw.error?.code}));
`);
 const s=executionSandbox(f.profile,{...f.bundle,script}),r=spawnSync(s.command,[...s.args,script,f.binary],{env:executionEnvironment(f.profile),cwd:f.profile.workspace,encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);
 const out=JSON.parse(r.stdout);assert.equal(out.result.code,0);assert.equal(out.detached,true);assert.equal(out.identity,true);assert.equal(out.raw,'EPERM');
 const group=(text:string)=>Number(text.trim().split(' ')[1]);assert.equal(group(out.result.out),group(out.bypass));assert.ok(group(out.bypass)>0);
});
for(const ending of ['abort','timeout','root-exit'] as const)test(`supervisor kills an orphaned grandchild after ${ending}`,async t=>{
 const f=fixture(t),record=join(f.profile.tmp,'pids'),s=executionSandbox(f.profile,f.bundle),controller=new AbortController();
 const worker=confinedProcess(s.command,[...s.args.slice(0,2),f.binary,ending==='root-exit'?'tree-exit':'tree',record],executionEnvironment(f.profile),f.profile.workspace,'',controller.signal,ending==='timeout'?1000:3000);
 const done=ending==='root-exit'?worker.done:assert.rejects(worker.done,/Confined process failed/);
 let rows:number[][]=[];
 try{
  for(let i=0;i<100;i++){if(existsSync(record))rows=readFileSync(record,'utf8').trim().split('\n').map(r=>r.split(' ').map(Number));if(rows.length===3)break;await new Promise(r=>setTimeout(r,5));}
  assert.equal(rows.length,3);const pgid=rows[0]![0]!;assert.ok(rows.every(r=>r[1]===pgid),'every descendant remains in the original group');
  if(ending==='abort')controller.abort();await done;
  // Orphaned zombies may briefly await launchd; they cannot execute or hold sockets.
  for(const [pid] of rows){const status=spawnSync('/bin/ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).stdout.trim();assert.ok(!status||status.startsWith('Z'),`process ${pid} still runnable: ${status}`);}
 }finally{controller.abort();await Promise.allSettled([worker.done]);}
});
