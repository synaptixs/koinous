import test from 'node:test';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {realpathSync,mkdtempSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {inspectionSandbox} from '../src/worker-sandbox.ts';
import {WorkerProfiles,workerEnvironment} from '../src/worker-profiles.ts';

function fixture(t:test.TestContext){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'koinous-os-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const a={tenant:'one',subject:'alice'},b={tenant:'one',subject:'bob'};
 const registry=new WorkerProfiles(root,[{...a,provider:'codex'},{...b,provider:'codex'}],[a,b]);
 return {root,a:registry.resolve(a,'codex')!,b:registry.resolve(b,'codex')!};
}
test('OS policy refuses unsupported platforms and confines its grants to inspection',t=>{
 const f=fixture(t),script=join(f.root,'probe.mjs');writeFileSync(script,'');
 assert.throws(()=>inspectionSandbox(f.a,script,'linux'),/requires macOS/);
 const s=inspectionSandbox(f.a,script),policy=s.args[1]!;
 assert.equal(s.command,'/usr/bin/sandbox-exec');assert.match(policy,/\(deny default\)/);
 for(const operation of ['network','file-write','process-fork','mach-lookup','ipc-posix'])assert.ok(!policy.includes(`(allow ${operation}`));
 assert.ok(!policy.includes(`(subpath "${f.a.home}")`));
 assert.ok(!s.args.includes('--allow-net'));assert.ok(!s.args.includes('--allow-child-process'));
});
test('kernel denies credential reads, cross-profile access, symlink escape, writes, children and sockets without Node permissions',async t=>{
 const f=fixture(t),credential=join(f.a.login,'auth.json'),other=join(f.b.login,'auth.json');
 writeFileSync(credential,'SYNTHETIC_ONLY',{mode:0o600});writeFileSync(other,'OTHER_SYNTHETIC_ONLY',{mode:0o600});
 const escape=join(f.a.workspace,'escape');symlinkSync(other,escape);
 // Quotes and spaces exercise policy serialization, not shell interpolation.
 const script=join(f.root,'probe "quoted".mjs');
 writeFileSync(script,`
import {readFileSync,writeFileSync,statSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {connect,createServer} from 'node:net';
const denied=fn=>{try{fn();return false;}catch(e){return ['EPERM','EACCES'].includes(e.code);}};
const socketDenied=options=>new Promise(resolve=>{const s=connect(options);s.on('error',e=>{s.destroy();resolve(['EPERM','EACCES'].includes(e.code));});s.on('connect',()=>{s.destroy();resolve(false);});});
const args=JSON.parse(process.argv[2]);
const results={nodePermissionsOff:!process.permission,ownerReadable:JSON.parse(readFileSync(args.owner,'utf8')).subject==='alice',credentialStat:statSync(args.credential).isFile(),credentialReadDenied:denied(()=>readFileSync(args.credential)),otherDenied:denied(()=>readFileSync(args.other)),escapeDenied:denied(()=>readFileSync(args.escape)),outsideListingDenied:denied(()=>readdirSync(args.outside)),writeDenied:denied(()=>writeFileSync(args.write,'forbidden')),childDenied:['EPERM','EACCES'].includes(spawnSync(process.execPath,['--version']).error?.code),tcpDenied:await socketDenied({host:'127.0.0.1',port:9}),unixDenied:await socketDenied({path:args.socket}),listenDenied:await new Promise(resolve=>{const s=createServer();s.on('error',e=>resolve(['EPERM','EACCES'].includes(e.code)));s.listen(0,'127.0.0.1',()=>s.close(()=>resolve(false)));})};
console.log(JSON.stringify(results));
`);
 const socket=join(f.root,'sock'),server=createServer(s=>s.destroy());
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve);});
 t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const sandbox=inspectionSandbox(f.a,script);
 const result=spawnSync(sandbox.command,[...sandbox.args,script,JSON.stringify({owner:join(f.a.root,'owner.json'),credential,other,escape,outside:f.b.root,write:join(f.a.workspace,'forbidden'),socket})],{env:workerEnvironment(f.a),cwd:f.a.workspace,encoding:'utf8',timeout:5000,maxBuffer:8192});
 assert.equal(result.status,0,result.stderr);const checks=JSON.parse(result.stdout);
 assert.equal(Object.keys(checks).length,12);for(const [name,value] of Object.entries(checks))assert.equal(value,true,name);
});

test('OS launcher failure is surfaced without retrying an unconfined worker',async t=>{
 const {default:cp}=await import('node:child_process');
 const {syncBuiltinESMExports}=await import('node:module');
 const {EventEmitter}=await import('node:events');
 const {PassThrough}=await import('node:stream');
 const {ProfileWorkers}=await import('../src/profile-worker.ts');
 const f=fixture(t),calls:string[]=[],workers=new ProfileWorkers();
 const replacement=t.mock.method(cp,'spawn',((command:string)=>{
  calls.push(command);const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
  queueMicrotask(()=>{child.emit('error',Object.assign(Error('Synthetic sandbox unavailable'),{code:'ENOENT'}));child.emit('close',null);});
  return child;
 }) as unknown as typeof cp.spawn);
 syncBuiltinESMExports();
 try{await assert.rejects(workers.inspect(f.a,new AbortController().signal),/Restricted worker preflight failed/);assert.deepEqual(calls,['/usr/bin/sandbox-exec']);}
 finally{replacement.mock.restore();syncBuiltinESMExports();await workers.shutdown();}
});
