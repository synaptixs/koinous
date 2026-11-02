import test from 'node:test';import assert from 'node:assert/strict';
import {connect,Socket} from 'node:net';
import {approvedHosts,connectHost,publicIPv4,WorkerEgress} from '../src/worker-egress.ts';
import type {EgressIO} from '../src/worker-egress.ts';
function request(port:number,data:string):Promise<string>{return new Promise((resolve,reject)=>{const s=connect({host:'127.0.0.1',port});let output='';s.setTimeout(1000,()=>s.destroy());s.on('connect',()=>s.end(data));s.on('data',chunk=>output+=chunk);s.on('error',reject);s.on('close',()=>resolve(output));});}
function auth(url:string){const u=new URL(url);return 'Basic '+Buffer.from(`${u.username}:${u.password}`).toString('base64');}
const head=(host:string,authorization:string)=>`CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\nProxy-Authorization: ${authorization}\r\n\r\n`;
test('destination policy rejects private, mapped, reserved addresses and authority normalization tricks',()=>{
 for(const address of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.1.1.1','255.255.255.255','::1','::ffff:8.8.8.8','2001:4860:4860::8888','127.1','2130706433'])assert.equal(publicIPv4(address),false,address);
 assert.equal(publicIPv4('8.8.8.8'),true);assert.equal(publicIPv4('1.1.1.1'),true);
 const hosts=approvedHosts(['approved.example']);assert.equal(connectHost('approved.example:443',hosts),'approved.example');
 for(const h of ['approved.example:80','APPROVED.example:443','approved.example.:443','approved.example.evil:443','user@approved.example:443','approved.example:443/','127.0.0.1:443','[::1]:443','approved%2eexample:443'])assert.throws(()=>connectHost(h,hosts));
 for(const h of [['*.example'],['https://approved.example'],['approved.example','approved.example'],['127.0.0.1']])assert.throws(()=>approvedHosts(h));
});
test('broker denies unauthenticated, wrong-worker, HTTP, malformed and unapproved destinations before DNS',async()=>{
 let resolved=0,dialed=0;const io:EgressIO={resolve:async()=>{resolved++;return ['8.8.8.8'];},dial:()=>{dialed++;throw Error();}};
 const a=new WorkerEgress(['approved.example'],io),b=new WorkerEgress(['approved.example'],io);const aa=await a.start(),bb=await b.start();
 try{for(const data of [head('approved.example:443','bad'),head('approved.example:443',auth(bb.url)),head('other.example:443',auth(aa.url)),head('approved.example:80',auth(aa.url)),head('approved.example:443',auth(aa.url))+'pipelined',`GET http://approved.example/ HTTP/1.1\r\nHost: approved.example\r\n\r\n`,head('approved.example:443',auth(aa.url)).replace('\r\n\r\n',`\r\nProxy-Authorization: ${auth(aa.url)}\r\n\r\n`)])assert.ok(!(await request(aa.port,data)).includes('200 Connection'));
 assert.equal(resolved,0);assert.equal(dialed,0);
 }finally{await a.close();await b.close();}
});
test('DNS mixed/public-private results fail before dialing and closing revokes late DNS work',async()=>{
 let dialed=0,release!:(value:string[])=>void;const broker=new WorkerEgress(['approved.example'],{resolve:async()=>['8.8.8.8','127.0.0.1'],dial:()=>{dialed++;throw Error();}});const a=await broker.start();
 try{await request(a.port,head('approved.example:443',auth(a.url)));assert.equal(dialed,0);}finally{await broker.close();}
 const late=new WorkerEgress(['approved.example'],{resolve:()=>new Promise(r=>{release=r;}),dial:()=>{dialed++;throw Error();}}),b=await late.start();
 const pending=request(b.port,head('approved.example:443',auth(b.url)));
 while(!release)await new Promise(r=>setTimeout(r,1));await late.close();release(['8.8.8.8']);await pending;await new Promise(r=>setImmediate(r));assert.equal(dialed,0);await assert.rejects(late.start(),/unavailable/);
});
test('approved DNS result is dialed by literal public IP, never resolved again',async()=>{
 const seen:string[]=[];const broker=new WorkerEgress(['approved.example'],{resolve:async host=>{seen.push(host);return ['8.8.8.8'];},dial:address=>{seen.push(address);const socket=new Socket();queueMicrotask(()=>socket.destroy(Error('synthetic dial failure')));return socket;}}),a=await broker.start();
 try{await request(a.port,head('approved.example:443',auth(a.url)));assert.deepEqual(seen,['approved.example','8.8.8.8']);}finally{await broker.close();}
});
test('broker bounds authenticated connection attempts',async()=>{
 let count=0;const broker=new WorkerEgress(['approved.example'],{resolve:async()=>{count++;return [];},dial:()=>{throw Error('unreachable');}}),a=await broker.start();
 try{for(let i=0;i<35;i++)await request(a.port,head('approved.example:443',auth(a.url)));assert.equal(count,32);}finally{await broker.close();}
});

test('authenticated tunnel forwards only payload and shutdown revokes active connections',async()=>{
 const {createServer}=await import('node:net');let received='';const upstream=createServer(socket=>socket.on('data',chunk=>{received+=chunk.toString();socket.write(chunk);}));
 await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const upstreamPort=(upstream.address() as any).port;
 const broker=new WorkerEgress(['approved.example'],{resolve:async()=>['8.8.8.8'],dial:address=>{assert.equal(address,'8.8.8.8');return connect({host:'127.0.0.1',port:upstreamPort});}}),a=await broker.start();
 const client=connect({host:'127.0.0.1',port:a.port});client.on('error',()=>{});
 try{
  let output='';await new Promise<void>((resolve,reject)=>{client.once('error',reject);client.on('data',chunk=>{output+=chunk;if(output.endsWith('synthetic-payload'))resolve();else if(output==='HTTP/1.1 200 Connection Established\r\n\r\n')client.write('synthetic-payload');});client.once('connect',()=>client.write(head('approved.example:443',auth(a.url))));});
  assert.equal(received,'synthetic-payload');const closed=new Promise<void>(resolve=>client.once('close',resolve));await broker.close();await closed;assert.equal(client.destroyed,true);
 }finally{client.destroy();await broker.close();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});

test('broker closes all tunnels when aggregate payload exceeds its byte ceiling',async()=>{
 const {createServer}=await import('node:net');const upstream=createServer(socket=>{socket.on('error',()=>{});socket.write(Buffer.alloc(17*1024*1024));});
 await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));const port=(upstream.address() as any).port;
 const broker=new WorkerEgress(['approved.example'],{resolve:async()=>['8.8.8.8'],dial:()=>connect({host:'127.0.0.1',port})}),a=await broker.start();
 const client=connect({host:'127.0.0.1',port:a.port});client.on('error',()=>{});client.resume();
 try{const closed=new Promise<void>(resolve=>client.once('close',resolve));client.once('connect',()=>client.write(head('approved.example:443',auth(a.url))));await closed;await assert.rejects(broker.start(),/unavailable/);}
 finally{client.destroy();await broker.close();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});
