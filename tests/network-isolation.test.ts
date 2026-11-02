import test from 'node:test';import assert from 'node:assert/strict';
import {createServer,connect} from 'node:net';import type {Server} from 'node:net';
import {mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {WorkerProfiles} from '../src/worker-profiles.ts';import {sdkBundle,executionSandbox,executionEnvironment} from '../src/sdk-execution.ts';import {WorkerEgress} from '../src/worker-egress.ts';import {prepareSDKBoundary} from '../src/sdk-boundary.ts';
function fixture(t:test.TestContext){const root=realpathSync(mkdtempSync(join(tmpdir(),'koinous-network-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const owner={tenant:'a',subject:'one'},profile=new WorkerProfiles(root,[{...owner,provider:'codex'}],[owner]).resolve(owner,'codex')!;return {root,profile};}
async function listen(server:Server,host:string,port=0){await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen({host,port,ipv6Only:true},resolve);});return (server.address() as {port:number}).port;}
async function reachable(host:string,port:number){await new Promise<void>((resolve,reject)=>{const s=connect({host,port});s.on('error',reject);s.on('connect',()=>{s.destroy();resolve();});});}
test('kernel permits broker IPv4 endpoint but blocks same-port IPv6, other ports and an alternate loopback address',async t=>{
 const f=fixture(t),servers=Array.from({length:3},()=>createServer(s=>s.end()));t.after(()=>{for(const s of servers)s.close();});
 const port=await listen(servers[0]!,'127.0.0.1');await listen(servers[1]!,'::1',port);const other=await listen(servers[2]!,'127.0.0.1');
 await Promise.all([reachable('127.0.0.1',port),reachable('::1',port),reachable('127.0.0.1',other)]);
 const script=join(f.root,'probe.mjs');writeFileSync(script,`
import {connect} from 'node:net';const port=Number(process.argv[2]),other=Number(process.argv[3]);
const probe=(host,port)=>new Promise(resolve=>{const s=connect({host,port});s.on('connect',()=>{s.destroy();resolve('allowed');});s.on('error',e=>resolve(e.code));});
console.log(JSON.stringify(await Promise.all([probe('127.0.0.1',port),probe('::1',port),probe('127.0.0.2',port),probe('127.0.0.1',other)])));
`);
 const s=executionSandbox(f.profile,{...sdkBundle('codex'),script},port),result=spawnSync(s.command,[...s.args,script,String(port),String(other)],{env:executionEnvironment(f.profile),cwd:f.profile.workspace,encoding:'utf8',timeout:3000});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),['allowed','EPERM','EPERM','EPERM']);
});
async function cannotRebind(port:number){const listener=createServer();try{await assert.rejects(listen(listener,'127.0.0.1',port),{code:'EADDRINUSE'});}finally{listener.close();}}
test('revocation retains the port lease, rejects new traffic and releases only on final close',async()=>{
 let lookups=0;const broker=new WorkerEgress(['approved.example'],{resolve:async()=>{lookups++;return [];},dial:()=>{throw Error('Never dial');}}),endpoint=await broker.start();
 try{broker.revoke();await cannotRebind(endpoint.port);await new Promise<void>((resolve,reject)=>{const s=connect({host:'127.0.0.1',port:endpoint.port});s.on('error',()=>{});s.on('close',resolve);s.on('connect',()=>s.write('CONNECT approved.example:443 HTTP/1.1\r\n\r\n'));s.setTimeout(1000,()=>{s.destroy();reject(Error('Revoked listener did not close connection'));});});assert.equal(lookups,0);}finally{await broker.close();}
 const replacement=createServer(s=>s.end());try{await listen(replacement,'127.0.0.1',endpoint.port);}finally{replacement.close();}
});
test('aborting prepared boundary revokes access without releasing the endpoint before teardown',async t=>{
 const f=fixture(t),controller=new AbortController(),boundary=await prepareSDKBoundary(f.profile,[],controller.signal,{resolve:async()=>{throw Error('Never resolve');},dial:()=>{throw Error('Never dial');}}),port=Number(new URL(boundary.env.HTTPS_PROXY!).port);
 try{controller.abort();await cannotRebind(port);}finally{await boundary.close();}
 const replacement=createServer(s=>s.end());try{await listen(replacement,'127.0.0.1',port);}finally{replacement.close();}
});

test('broker lifetime expiry revokes traffic but keeps its endpoint reserved',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const broker=new WorkerEgress([],{resolve:async()=>{throw Error('Never resolve');},dial:()=>{throw Error('Never dial');}});
 try{const endpoint=await broker.start();t.mock.timers.tick(120000);await cannotRebind(endpoint.port);await assert.rejects(broker.start(),/unavailable/);}finally{await broker.close();t.mock.timers.reset();}
});
