import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {buildProtocol} from '../src/grok-build.ts';
import {withDeadline,ProviderFailure} from '../src/provider-runtime.ts';
// Same outer deadline can mask distinct stalled ACP stages. No CLI, credentials or network.
for(const stalled of ['initialize','authenticate','session/new','session/prompt'])test(`offline ACP stall at ${stalled} produces the same outer timeout and no fallback`,async()=>{
 const methods:string[]=[];let killed=false;
 const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){killed=true;return true;}});
 child.stdin.on('data',(bytes:Buffer)=>{const m=JSON.parse(bytes.toString());methods.push(m.method);if(m.method===stalled)return;
  const result=m.method==='initialize'?{protocolVersion:1,authMethods:[{id:'grok.com'}]}:m.method==='session/new'?{sessionId:'synthetic'}:{};
  queueMicrotask(()=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n'));
 });
 let protocol:Promise<unknown>|undefined;
 await assert.rejects(withDeadline(signal=>{protocol=buildProtocol(child as unknown as ChildProcessWithoutNullStreams,'/synthetic',signal,'synthetic',false,'grok.com');return protocol;},new AbortController().signal,20),e=>{assert.ok(e instanceof ProviderFailure);assert.equal(e.code,'timeout');assert.equal(e.message,'Provider exceeded 20 ms deadline');const stages=['startup','authentication','session-creation','inference'];const i=['initialize','authenticate','session/new','session/prompt'].indexOf(stalled);assert.equal(e.details.protocolTiming?.lastStage,stages[i]);assert.equal(e.details.protocolTiming?.stages.length,i+1);assert.equal(e.details.protocolTiming?.stages.at(-1)?.completed,false);return true;});
 await protocol?.catch(()=>{});assert.equal(killed,true);assert.equal(methods.at(-1),stalled);assert.equal(new Set(methods).size,methods.length);assert.equal(methods.filter(x=>x==='session/prompt').length,stalled==='session/prompt'?1:0);
});
