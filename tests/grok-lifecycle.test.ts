import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GrokVMLifecycle,SANDBOX_CHECKS,verifyVMArtifacts,type VMConfig} from '../src/grok-vm-lifecycle.ts';
import {ManagedGrokBuildAdapter} from '../src/grok-managed.ts';
import {vmCommand} from '../src/vm-command.ts';
import type {launchBuild} from '../src/grok-build.ts';

function fixture(t:test.TestContext,fail='',foreign=false){
  const root=mkdtempSync(join(tmpdir(),'koinous-managed-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const binary=join(root,'grok');writeFileSync(binary,'offline fixture');
  const config:VMConfig={podman:'/fixture/podman',authHome:join(root,'auth'),binary,image:'/fixture/image',imageSha256:'a'.repeat(64),stateDir:root};
  const commands:string[][]=[];let exists=false;let stage='';let failEnabled=true;
  const manager=new GrokVMLifecycle(config,{verifyArtifacts:async()=>{},command:async(_bin,args,_ms,signal)=>{
    signal?.throwIfAborted();commands.push(args);
    const op=args[1];
    if(op==='init'){exists=true;stage=args[args.indexOf('--volume')+1].split(':')[0];}
    const phase=op==='ssh'?(args[3].includes('remount')?'mount':args[3].includes('sandbox-probe')?'probe':'cleanup'):op;
    if(failEnabled&&phase===fail)throw Error('synthetic failure');
    if(op==='list'&&stage&&!exists&&fail==='absence-unknown'&&failEnabled)throw Error('inventory unavailable');
    if(op==='list')return JSON.stringify(foreign?[{Name:'foreign',Running:true}]:exists?[{Name:manager.connection.vm,Running:true}]:[]);
    if(op==='rm')exists=false;
    if(phase==='probe')return JSON.stringify({...Object.fromEntries(SANDBOX_CHECKS.map(k=>[k,fail!=='unsafe-probe'])),networkNamespaceIsolated:fail==='missing-network'?undefined:fail!=='network-namespace',networkInterfacesIsolated:fail!=='network-interface'});
    if(phase==='cleanup')return fail==='credentials-remain'?'false':'true';
    return '';
  }});
  return {manager,root,config,commands,getStage:()=>stage,allowRecovery:()=>{failEnabled=false;}};
}
test('managed lifecycle shares only staged artifacts and verifies sandbox before readiness; removal is idempotent',async t=>{
  const f=fixture(t);await f.manager.prepare(new AbortController().signal);f.manager.assertReady();
  assert.deepEqual(readdirSync(f.getStage()).sort(),['egress.py','grok','integrated-guest.py','sandbox-probe.py']);
  assert.match(f.commands.find(c=>c[1]==='init')!.join(' '),/:\/var\/mnt\/koinous:ro/);
  assert.equal(f.commands.filter(c=>c[1]==='init').length,1);
  await f.manager.dispose();assert.ok(!existsSync(f.getStage()));assert.ok(!existsSync(join(f.root,'grok-vm.lock')));
  const audit=JSON.parse(readFileSync(join(f.root,f.manager.connection.vm+'.json'),'utf8'));
  assert.equal(audit.phase,'removed');assert.equal(audit.guestCredentialsAbsent,true);
  const n=f.commands.length;await f.manager.dispose();assert.equal(f.commands.length,n);assert.throws(()=>f.manager.assertReady());
});
for(const failure of ['init','start','mount','probe','unsafe-probe','network-namespace','network-interface','missing-network'])test(`${failure} failure tears down partially created VM without credentials`,async t=>{
  const f=fixture(t,failure);await assert.rejects(f.manager.prepare(new AbortController().signal));
  await f.manager.dispose();assert.ok(f.commands.some(c=>c[1]==='rm'));assert.ok(!existsSync(f.getStage()));
  assert.ok(!JSON.stringify(f.commands).includes('auth.json'));
});
test('failed removal retains lock and ownership journal; retry can recover only this VM',async t=>{
  const f=fixture(t,'rm');await f.manager.prepare(new AbortController().signal);
  await assert.rejects(f.manager.dispose(),/cleanup unverified/);
  const journal=JSON.parse(readFileSync(join(f.root,'grok-vm.lock/owner.json'),'utf8'));
  assert.equal(journal.vm,f.manager.connection.vm);assert.equal(journal.phase,'cleanup-unverified');assert.ok(existsSync(f.getStage()));
  f.allowRecovery();await f.manager.dispose();assert.ok(!existsSync(join(f.root,'grok-vm.lock')));
});
test('existing running VM is never stopped or removed',async t=>{
  const f=fixture(t,'',true);await assert.rejects(f.manager.prepare(new AbortController().signal),/existing VM/);await f.manager.dispose();
  assert.deepEqual(f.commands.map(c=>c[1]),['list']);
});
test('cross-instance lock prevents concurrent provisioning; second dispose cannot remove first lock',async t=>{
  const f=fixture(t);await f.manager.prepare(new AbortController().signal);
  let commands=0;const second=new GrokVMLifecycle(f.config,{verifyArtifacts:async()=>{},command:async()=>{commands++;return '[]';}});
  await assert.rejects(second.prepare(new AbortController().signal),/locked/);await second.dispose();
  assert.equal(commands,0);assert.ok(existsSync(join(f.root,'grok-vm.lock')));await f.manager.dispose();
});
test('pre-aborted and invalid configurations never provision',async t=>{
  const f=fixture(t);await assert.rejects(f.manager.prepare(AbortSignal.abort()));assert.equal(f.commands.length,0);
  const bad=new GrokVMLifecycle({...f.config,imageSha256:'wrong'});await assert.rejects(bad.prepare(new AbortController().signal),/absolute paths/);
  await assert.rejects(verifyVMArtifacts(f.config));
});
test('cancel during provisioning still permits independent teardown',async t=>{
  const f=fixture(t);const controller=new AbortController();
  const original=f.config;let exists=false;
  const manager=new GrokVMLifecycle(original,{verifyArtifacts:async()=>{},command:async(_b,args,_ms,signal)=>{
    if(args[1]==='list')return JSON.stringify(exists?[{Name:manager.connection.vm,Running:false}]:[]);
    if(args[1]==='init'){exists=true;controller.abort();signal?.throwIfAborted();}
    if(args[1]==='rm'){assert.equal(signal,undefined);exists=false;}
    return 'true';
  }});
  await assert.rejects(manager.prepare(controller.signal));await manager.dispose();assert.equal(exists,false);
});
test('managed adapter gates calls on auth-only preflight and carries explicit model/connection without environment mutation',async t=>{
  const f=fixture(t);const prior=process.env.GROK_BUILD_ENABLE_INFERENCE;process.env.GROK_BUILD_ENABLE_INFERENCE='1';
  t.after(()=>{if(prior===undefined)delete process.env.GROK_BUILD_ENABLE_INFERENCE;else process.env.GROK_BUILD_ENABLE_INFERENCE=prior;});
  const calls:Parameters<typeof launchBuild>[]=[];
  const adapter=new ManagedGrokBuildAdapter('explicit-model',f.manager,async(...args)=>{calls.push(args);return {text:'answer',usage:{usd:null}};});
  await assert.rejects(adapter.run('question',1,new AbortController().signal));
  await adapter.prepare(new AbortController().signal);assert.equal(calls.length,1);assert.equal(calls[0][1],undefined);
  const result=await adapter.run('question',1,new AbortController().signal);assert.equal(result.usage?.usd,null);
  assert.equal(calls[1][3],'explicit-model');assert.equal(calls[1][4],f.manager.connection);await adapter.dispose();
});
test('authentication failure cannot dispatch models and still cleans VM',async t=>{
 const f=fixture(t);const prior=process.env.GROK_BUILD_ENABLE_INFERENCE;process.env.GROK_BUILD_ENABLE_INFERENCE='1';
 t.after(()=>{if(prior===undefined)delete process.env.GROK_BUILD_ENABLE_INFERENCE;else process.env.GROK_BUILD_ENABLE_INFERENCE=prior;});
 const adapter=new ManagedGrokBuildAdapter('model',f.manager,async()=>{throw Error('offline auth rejection');});
 await assert.rejects(adapter.prepare(new AbortController().signal));await assert.rejects(adapter.run('question',1,new AbortController().signal),/authentication/);
 await adapter.dispose();assert.ok(!existsSync(join(f.root,'grok-vm.lock')));
});
test('disabled inference prevents all provisioning',async t=>{
 const f=fixture(t);const prior=process.env.GROK_BUILD_ENABLE_INFERENCE;delete process.env.GROK_BUILD_ENABLE_INFERENCE;
 t.after(()=>{if(prior!==undefined)process.env.GROK_BUILD_ENABLE_INFERENCE=prior;});
 await assert.rejects(new ManagedGrokBuildAdapter('model',f.manager).prepare(new AbortController().signal),/disabled/);assert.equal(f.commands.length,0);
});
test('bounded command runner executes no shell, redacts failures, strips API keys and terminates on timeout',async()=>{
 assert.equal(await vmCommand(process.execPath,['-e','process.stdout.write("ok")'],5000),'ok');
 await assert.rejects(vmCommand(process.execPath,['-e','process.stderr.write("SECRET");process.exit(1)'],5000),e=>e instanceof Error&&!e.message.includes('SECRET'));
 await assert.rejects(vmCommand(process.execPath,['-e','setInterval(()=>{},1000)'],20));
 await assert.rejects(vmCommand(process.execPath,['-e','process.stdout.write("x".repeat(100000))'],5000));
 assert.equal(await vmCommand(process.execPath,['-e','process.stdout.write(String(Object.keys(process.env).some(k=>/API_KEY/.test(k))))'],5000),'false');
});

test('generated VM names satisfy Podman 30-character maximum and remain distinct',t=>{
 const f=fixture(t);const other=new GrokVMLifecycle(f.config);
 for(const runtime of [f.manager,other]){assert.ok(runtime.connection.vm.length<=30);assert.match(runtime.connection.vm,/^koinous-grok-[a-f0-9]{16}$/);}
 assert.notEqual(f.manager.connection.vm,other.connection.vm);
});

for(const failure of ['credentials-remain','cleanup','stop'])test(`guest cleanup ${failure} still requires VM absence and records uncertainty`,async t=>{
 const f=fixture(t,failure);await f.manager.prepare(new AbortController().signal);await f.manager.dispose();
 const audit=JSON.parse(readFileSync(join(f.root,f.manager.connection.vm+'.json'),'utf8'));
 assert.equal(audit.phase,'removed');assert.equal(audit.guestCredentialsAbsent,failure==='cleanup'?null:failure==='credentials-remain'?false:true);
 assert.ok(f.commands.some(c=>c[1]==='rm'));assert.equal(existsSync(join(f.root,'grok-vm.lock')),false);assert.equal(existsSync(f.getStage()),false);
});
test('concurrent disposal shares one owned teardown and remains retryable',async t=>{
 const f=fixture(t);await f.manager.prepare(new AbortController().signal);
 await Promise.all([f.manager.dispose(),f.manager.dispose(),f.manager.dispose()]);assert.equal(f.commands.filter(c=>c[1]==='rm').length,1);
 assert.equal(existsSync(join(f.root,'grok-vm.lock')),false);
});

test('unverifiable VM absence retains lock even when removal command succeeded',async t=>{
 const f=fixture(t,'absence-unknown');await f.manager.prepare(new AbortController().signal);await assert.rejects(f.manager.dispose(),/cleanup unverified/);
 assert.equal(existsSync(join(f.root,'grok-vm.lock')),true);assert.equal(existsSync(f.getStage()),true);
 f.allowRecovery();await f.manager.dispose();assert.equal(existsSync(join(f.root,'grok-vm.lock')),false);
});
