import test from 'node:test';
import assert from 'node:assert/strict';
import {GrokDiagnosticsCollector,PROXY_COUNTERS} from '../src/grok-diagnostics.ts';
const frame=(value:unknown)=>Buffer.from('KOINOUS_GROK_PROXY_V1 '+JSON.stringify(value)+'\n');
const counters=(n=0)=>Object.fromEntries(PROXY_COUNTERS.map(k=>[k,n]));
test('proxy frames are strict, bounded, monotonic, immutable and content-free',()=>{
 const d=new GrokDiagnosticsCollector();
 for(const bad of [null,[],{}, {...counters(),host:'PRIVATE'}, {...counters(),secret:'PRIVATE'}, {...counters(),dns:-1}, {...counters(),dns:1.5}, {...counters(),dns:2147483648}])d.stderr(frame(bad));
 assert.equal(d.snapshot().proxy,null);
 const bytes=frame(counters(1));d.stderr(bytes.subarray(0,17));d.stderr(bytes.subarray(17));
 assert.equal(d.snapshot().proxy?.dns,1);d.stderr(frame(counters(0)));assert.equal(d.snapshot().proxySnapshots,1);
 const snapshot=d.snapshot();assert.throws(()=>{(snapshot.proxy as Record<string,number>).dns=3;});
 d.stderr(Buffer.concat([Buffer.from('PRIVATE'.repeat(1000)),frame(counters(2))]));assert.equal(d.snapshot().proxy?.dns,1);
 for(let i=0;i<200;i++)d.stderr(frame(counters(2)));
 assert.equal(d.snapshot().proxySnapshots,122);assert.equal(snapshot.proxy?.dns,1);
 assert.ok(JSON.stringify(d.snapshot()).length<500);assert.doesNotMatch(JSON.stringify(d.snapshot()),/PRIVATE/);
});
test('progress counts activity without retaining notification payloads',()=>{
 const d=new GrokDiagnosticsCollector();d.observe('thoughtChunks');d.observe('messageChunks');d.observe('sessionNotifications');
 assert.deepEqual(d.snapshot().progress,{thoughtChunks:1,messageChunks:1,sessionNotifications:1});
 assert.equal(d.snapshot().proxy,null);assert.throws(()=>{(d.snapshot().progress as {thoughtChunks:number}).thoughtChunks=9;});
});
