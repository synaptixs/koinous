import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync,existsSync,readdirSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {connect} from 'node:net';
import {CredentialWorkers,type CredentialWorkerDriver} from '../src/credential-worker.ts';
import {WorkerProfiles} from '../src/worker-profiles.ts';import {prepareSDKBoundary} from '../src/sdk-boundary.ts';
import {executionSandbox} from '../src/sdk-execution.ts';
import {confinedProcess} from '../src/confined-process.ts';import {ProviderFailure} from '../src/provider-runtime.ts';
const owner={tenant:'one',subject:'a'},other={tenant:'one',subject:'b'};
function fixture(t:test.TestContext){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'koinous-lease-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const profiles=new WorkerProfiles(root,[{...owner,provider:'codex'},{...owner,provider:'claude'},{...other,provider:'codex'}],[owner,other]);
 for(const id of [owner,other])writeFileSync(join(profiles.resolve(id,'codex')!.login,'auth.json'),'SYNTHETIC_CREDENTIAL',{mode:0o600});
 return {profiles,p:profiles.resolve(owner,'codex')!,other:profiles.resolve(other,'codex')!};
}
function driver(f:ReturnType<typeof fixture>,mode='success'){
 const scratch:string[]=[],ports:number[]=[],order:string[]=[];let launches=0,ready!:()=>void;
 const started=new Promise<void>(resolve=>ready=resolve);
 const io:CredentialWorkerDriver={prepare:async(p,signal)=>{
  scratch.push(p.tmp);const boundary=await prepareSDKBoundary(p,[],signal,{resolve:async()=>{throw Error('No DNS allowed');},dial:()=>{throw Error('No dial allowed');}});
  ports.push(Number(new URL(boundary.env.HTTPS_PROXY!).port));const close=boundary.close;
  boundary.close=async()=>{order.push('broker-close');await close();};return boundary;
 },launch:(p,b,signal,deadline)=>{
  launches++;const script=join(p.tmp,'fixture.mjs');writeFileSync(script,`
import {readFileSync,writeFileSync} from 'node:fs';
const p=${JSON.stringify(p)},other=${JSON.stringify(f.other.login)};
let denied=false;try{readFileSync(other+'/auth.json');}catch(e){denied=['EPERM','EACCES'].includes(e.code);}
const own=readFileSync(p.login+'/auth.json','utf8')==='SYNTHETIC_CREDENTIAL';
writeFileSync(p.tmp+'/scratch','SYNTHETIC_TEMP');
${mode==='hang'?"setInterval(()=>{},1000);":mode==='failure'?"process.exit(9);":"console.log(JSON.stringify({own,denied,inference:process.env.KOINOUS_ENABLE_INFERENCE,apiKeys:Object.keys(process.env).filter(k=>/API_KEY|AUTH_TOKEN/.test(k))}));"}
`);
  const sandbox=executionSandbox(p,{...b.bundle,script},Number(new URL(b.env.HTTPS_PROXY!).port),true);
  const worker=confinedProcess(sandbox.command,[...sandbox.args,script],b.env,p.workspace,'',signal,deadline);
  const done=worker.done.finally(()=>order.push('reaped'));ready();return {done,stop:worker.stop};
 }};
 return {io,scratch,ports,order,started,get launches(){return launches;}};
}
async function portClosed(port:number){await new Promise<void>((resolve,reject)=>{const socket=connect({host:'127.0.0.1',port});socket.once('connect',()=>{socket.destroy();reject(Error('Broker still listening'));});socket.once('error',()=>resolve());});}
async function clean(f:ReturnType<typeof fixture>,d:ReturnType<typeof driver>){
 assert.equal(existsSync(join(f.p.root,'worker.lease')),false);assert.deepEqual(readdirSync(f.p.tmp),[]);
 for(const path of d.scratch)assert.equal(existsSync(path),false);for(const port of d.ports)await portClosed(port);
 assert.equal(readFileSync(join(f.p.login,'auth.json'),'utf8'),'SYNTHETIC_CREDENTIAL');
 assert.equal(readFileSync(join(f.other.login,'auth.json'),'utf8'),'SYNTHETIC_CREDENTIAL');
 if(d.launches)assert.ok(d.order.indexOf('reaped')<d.order.indexOf('broker-close'));
}
test('credential lifecycle uses only own synthetic login, fresh scratch and ordered cleanup',async t=>{
 const f=fixture(t),d=driver(f),workers=new CredentialWorkers(f.profiles,d.io);
 for(let i=0;i<2;i++){const output=JSON.parse(await workers.run(owner,'codex',new AbortController().signal));assert.deepEqual(output,{own:true,denied:true,inference:'0',apiKeys:[]});await clean(f,d);}
 assert.notEqual(d.scratch[0],d.scratch[1]);await workers.shutdown();
});
for(const ending of ['failure','abort','timeout','shutdown'])test(`credential lifecycle ${ending} reaps child, closes broker and removes scratch`,async t=>{
 const f=fixture(t),d=driver(f,ending==='failure'?'failure':'hang'),workers=new CredentialWorkers(f.profiles,d.io),c=new AbortController();
 const work=workers.run(owner,'codex',c.signal,ending==='timeout'?400:3000);
 const rejected=assert.rejects(work,e=>e instanceof ProviderFailure&&e.code===(ending==='timeout'?'timeout':ending==='failure'?'provider_error':'cancelled'));
 await d.started;if(ending==='abort')c.abort();if(ending==='shutdown')await workers.shutdown();await rejected;await clean(f,d);await workers.shutdown();
});
test('exclusive profile lease rejects overlapping managers and stale leases without launching',async t=>{
 const f=fixture(t),d=driver(f,'hang'),a=new CredentialWorkers(f.profiles,d.io),b=new CredentialWorkers(f.profiles,d.io),c=new AbortController();
 const pending=a.run(owner,'codex',c.signal);const rejected=assert.rejects(pending);await d.started;
 await assert.rejects(b.run(owner,'codex',new AbortController().signal));assert.equal(d.launches,1);c.abort();await rejected;await clean(f,d);
 mkdirSync(join(f.p.root,'worker.lease'),{mode:0o700});await assert.rejects(b.run(owner,'codex',new AbortController().signal));assert.equal(d.launches,1);
 await a.shutdown();await b.shutdown();
});
test('unknown owner, provider, pre-abort and disabled default never prepare credentials',async t=>{
 const f=fixture(t),d=driver(f),workers=new CredentialWorkers(f.profiles,d.io),c=new AbortController();c.abort();
 await assert.rejects(new CredentialWorkers(f.profiles).run(owner,'codex',new AbortController().signal),/disabled/);
 await assert.rejects(workers.run({...owner,tenant:'unknown'},'codex',new AbortController().signal));
 await assert.rejects(workers.run(owner,'grok',new AbortController().signal));await assert.rejects(workers.run(owner,'codex',c.signal));
 await workers.shutdown();await assert.rejects(workers.run(owner,'codex',new AbortController().signal));assert.equal(d.launches,0);assert.equal(d.scratch.length,0);
});
test('preparation or launch failure removes the lease and scratch without touching persistent login',async t=>{
 for(const phase of ['prepare','launch']){const f=fixture(t),d=driver(f);const io={...d.io,[phase]:()=>{throw Error('PRIVATE_FAILURE');}} as CredentialWorkerDriver;
 await assert.rejects(new CredentialWorkers(f.profiles,io).run(owner,'codex',new AbortController().signal),e=>e instanceof ProviderFailure&&!e.message.includes('PRIVATE'));
 await clean(f,d);}
});
test('ownership tampering during preparation prevents launch and releases resources',async t=>{
 const f=fixture(t),d=driver(f),io={...d.io,prepare:async(...args:Parameters<CredentialWorkerDriver['prepare']>)=>{const boundary=await d.io.prepare(...args);writeFileSync(join(f.p.root,'owner.json'),'{}');return boundary;}};
 await assert.rejects(new CredentialWorkers(f.profiles,io).run(owner,'codex',new AbortController().signal));assert.equal(d.launches,0);await clean(f,d);
});

test('cancellation during preparation prevents launch and waits for cleanup',async t=>{
 const f=fixture(t),d=driver(f),c=new AbortController();let release!:()=>void,ready!:()=>void;
 const entered=new Promise<void>(r=>ready=r),gate=new Promise<void>(r=>release=r);
 const workers=new CredentialWorkers(f.profiles,{...d.io,prepare:async(...args)=>{const b=await d.io.prepare(...args);ready();await gate;return b;}});
 const work=workers.run(owner,'codex',c.signal);const rejected=assert.rejects(work,e=>e instanceof ProviderFailure&&e.code==='cancelled');
 await entered;c.abort();assert.equal(existsSync(join(f.p.root,'worker.lease')),true);release();await rejected;assert.equal(d.launches,0);await clean(f,d);
});
test('cleanup failure retains exclusive lease and prevents profile reuse',async t=>{
 const f=fixture(t),d=driver(f),workers=new CredentialWorkers(f.profiles,{...d.io,prepare:async(...args)=>{const b=await d.io.prepare(...args),close=b.close;b.close=async()=>{await close();throw Error('Synthetic cleanup failure');};return b;}});
 await assert.rejects(workers.run(owner,'codex',new AbortController().signal));assert.equal(existsSync(join(f.p.root,'worker.lease')),true);
 await assert.rejects(workers.run(owner,'codex',new AbortController().signal));assert.equal(d.launches,1);for(const port of d.ports)await portClosed(port);
});
test('a lease for one user does not block a separate user profile',async t=>{
 const f=fixture(t),a=driver(f,'hang'),b=driver(f),first=new CredentialWorkers(f.profiles,a.io),second=new CredentialWorkers(f.profiles,b.io),c=new AbortController();
 const pending=first.run(owner,'codex',c.signal);const rejected=assert.rejects(pending);await a.started;
 try{const output=JSON.parse(await second.run(other,'codex',new AbortController().signal));assert.equal(output.own,true);assert.equal(existsSync(join(f.other.root,'worker.lease')),false);assert.deepEqual(readdirSync(f.other.tmp),[]);}finally{c.abort();await rejected;await first.shutdown();await second.shutdown();}
 await clean(f,a);
});

test('Claude lifecycle scopes subscription config and cleans scratch without deleting login',async t=>{
 const base=fixture(t),p=base.profiles.resolve(owner,'claude')!;writeFileSync(join(p.login,'auth.json'),'SYNTHETIC_CREDENTIAL',{mode:0o600});
 const f={...base,p},d=driver(f),workers=new CredentialWorkers(f.profiles,d.io);
 const output=JSON.parse(await workers.run(owner,'claude',new AbortController().signal));assert.deepEqual(output,{own:true,denied:true,inference:'0',apiKeys:[]});await clean(f,d);await workers.shutdown();
});
