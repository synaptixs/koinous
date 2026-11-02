import {createServer} from 'node:http';
import {connect,isIP,Socket} from 'node:net';
import {lookup} from 'node:dns/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';

// Conservative IPv4-only routing. IPv6, mapped addresses and special ranges are
// rejected rather than relying on ambiguous DNS/proxy normalization.
export function publicIPv4(address:string):boolean {
 if(isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number) as [number,number,number,number];
 return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a===192&&b===0||a===192&&b===88&&c===99||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
}
export function approvedHosts(input:readonly string[]):ReadonlySet<string>{
 if(!Array.isArray(input)||input.length>16||new Set(input).size!==input.length||input.some(h=>typeof h!=='string'||h.length>253||! /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/.test(h)||isIP(h)!==0))throw Error('Invalid exact egress hosts');
 return new Set(input);
}
export function connectHost(authority:string,hosts:ReadonlySet<string>):string {
 const match=/^([a-z0-9.-]+):443$/.exec(authority);if(!match||!hosts.has(match[1]!))throw Error('Destination denied');return match[1]!;
}
export type EgressIO={resolve:(host:string)=>Promise<string[]>;dial:(address:string)=>Socket};
const systemIO:EgressIO={resolve:async host=>(await lookup(host,{all:true,family:4})).map(r=>r.address),dial:address=>connect({host:address,port:443,family:4})};
export class WorkerEgress {
 private readonly hosts:ReadonlySet<string>;private readonly secret=randomBytes(32).toString('hex');
 private readonly sockets=new Set<Socket>();private stopped=false;private started=false;private attempts=0;private bytes=0;
 private readonly server=createServer({maxHeaderSize:4096,headersTimeout:5000,requestTimeout:5000},(_req,res)=>{res.writeHead(403);res.end();});
 private timer?:NodeJS.Timeout;private readonly io:EgressIO;
 // IO injection is for deterministic offline tests; it is never supplied by HTTP/config.
 constructor(hosts:readonly string[],io:EgressIO=systemIO){
  this.io=io;
  this.hosts=approvedHosts(hosts);
  this.server.on('connection',socket=>{if(this.stopped||this.sockets.size>=16){socket.destroy();return;}this.sockets.add(socket);socket.setTimeout(5000,()=>socket.destroy());socket.on('error',()=>{});socket.on('close',()=>this.sockets.delete(socket));});
  this.server.on('clientError',(_error,socket)=>socket.destroy());
  this.server.on('connect',(req,socket,head)=>{void this.tunnel(req.url??'',req.rawHeaders,socket as Socket,head);});
 }
 async start(){
  if(this.started||this.stopped)throw Error('Broker unavailable');this.started=true;
  await new Promise<void>((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
  if(this.stopped){await this.close();throw Error('Broker unavailable');}
  this.timer=setTimeout(()=>this.revoke(),120000);
  const address=this.server.address();if(!address||typeof address==='string')throw Error('Broker unavailable');
  return Object.freeze({port:address.port,url:`http://worker:${this.secret}@127.0.0.1:${address.port}`});
 }
 private async tunnel(authority:string,headers:string[],client:Socket,head:Buffer){
  let upstream:Socket|undefined;const fail=()=>{client.destroy();upstream?.destroy();};
  try{
   client.setTimeout(5000,fail);
   if(this.stopped||++this.attempts>32||head.length)throw Error();
   const auth=[];for(let i=0;i<headers.length;i+=2)if(headers[i]!.toLowerCase()==='proxy-authorization')auth.push(headers[i+1]);
   const expected=Buffer.from(`Basic ${Buffer.from(`worker:${this.secret}`).toString('base64')}`),actual=Buffer.from(auth.length===1?auth[0]??'':'');
   if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();
   const host=connectHost(authority,this.hosts);
   // A bounded client lifetime also bounds DNS; a late result cannot dial.
   const addresses=await this.io.resolve(host);
   if(this.stopped||client.destroyed||!addresses.length||addresses.some(a=>!publicIPv4(a)))throw Error();
   upstream=this.io.dial(addresses[0]!);const remote=upstream;this.sockets.add(remote);
   remote.on('error',fail);remote.setTimeout(15000,fail);remote.on('close',()=>{this.sockets.delete(remote);client.destroy();});client.on('close',()=>remote.destroy());
   const count=(chunk:Buffer)=>{this.bytes+=chunk.length;if(this.bytes>16*1024*1024)this.revoke();};client.on('data',count);remote.on('data',count);
   remote.once('connect',()=>{if(this.stopped||client.destroyed)return fail();client.setTimeout(15000,fail);client.write('HTTP/1.1 200 Connection Established\r\n\r\n');client.pipe(remote);remote.pipe(client);});
  }catch{fail();}
 }
 // Revoke data access but retain the listener, preventing port reuse while a
 // worker may still exist. Final close belongs after process-group teardown.
 revoke(){this.stopped=true;clearTimeout(this.timer);for(const s of this.sockets)s.destroy();this.sockets.clear();}
 async close(){
  this.revoke();
  if(this.server.listening)await new Promise<void>(resolve=>this.server.close(()=>resolve()));
 }
}
