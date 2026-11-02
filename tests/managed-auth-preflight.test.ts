import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {authenticationPreflight,authenticationOnlySpawn} from '../scripts/grok-managed-auth-preflight.ts';
for(const failure of ['none','prepare','authentication','cleanup'])test(`managed authentication-only ${failure} keeps inference disabled and always disposes`,async t=>{
 const old=process.env.GROK_BUILD_ENABLE_INFERENCE;process.env.GROK_BUILD_ENABLE_INFERENCE='0';t.after(()=>{if(old===undefined)delete process.env.GROK_BUILD_ENABLE_INFERENCE;else process.env.GROK_BUILD_ENABLE_INFERENCE=old;});
 const order:string[]=[];
 const runtime={connection:{podman:'/fixture/podman',vm:'koinous-grok-fixture',authHome:'/fixture/auth'},async prepare(){order.push('prepare');if(failure==='prepare')throw Error('failed');},assertReady(){order.push('ready');},async dispose(){order.push('dispose');if(failure==='cleanup')throw Error('failed');}};
 const work=authenticationPreflight(runtime,new AbortController().signal,async(_signal,prompt,_spawn,_model,connection)=>{
   assert.equal(prompt,undefined);assert.equal(connection,runtime.connection);assert.equal(process.env.GROK_BUILD_ENABLE_INFERENCE,'0');order.push('authenticate');if(failure==='authentication')throw Error('failed');return {text:'authenticated'};
 });
 if(failure==='none')await work;else await assert.rejects(work);
 assert.deepEqual(order,failure==='prepare'?['prepare','dispose']:['prepare','ready','authenticate','dispose']);
});
test('protocol guard blocks model/session requests and records only authentication method names',()=>{
 const stdin=new PassThrough();const methods:string[]=[];const chunks:string[]=[];stdin.on('data',chunk=>chunks.push(String(chunk)));
 const start=authenticationOnlySpawn(methods,()=>({stdin} as unknown as ChildProcessWithoutNullStreams));
 const child=start({binary:'/fixture',args:[],cwd:'/fixture',env:{}});
 child.stdin.write(JSON.stringify({auth:'synthetic-credential'}));
 child.stdin.write(JSON.stringify({method:'initialize'}));child.stdin.write(JSON.stringify({method:'authenticate',params:{methodId:'grok.com'}}));
 for(const method of ['session/new','session/prompt'])assert.throws(()=>child.stdin.write(JSON.stringify({method})),/forbidden/);
 assert.deepEqual(methods,['initialize','authenticate']);assert.equal(chunks.length,3);assert.ok(!JSON.stringify(methods).includes('credential'));
});
