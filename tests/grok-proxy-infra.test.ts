import test from 'node:test';import assert from 'node:assert/strict';
import {proxyInfrastructurePreflight} from '../scripts/grok-proxy-infra-preflight.ts';
for(const failure of ['none','prepare','probe','cleanup'])test(`synthetic proxy infrastructure ${failure} always attempts owned cleanup`,async()=>{
 const order:string[]=[];const runtime={prepare:async()=>{order.push('prepare');if(failure==='prepare')throw Error('fixture');},assertReady:()=>{order.push('ready');},dispose:async()=>{order.push('dispose');if(failure==='cleanup')throw Error('fixture');}};
 const work=proxyInfrastructurePreflight(runtime,async()=>{order.push('probe');if(failure==='probe')throw Error('fixture');return {synthetic:true};},new AbortController().signal);
 if(failure==='none')assert.deepEqual(await work,{synthetic:true});else await assert.rejects(work);
 assert.equal(order.at(-1),'dispose');assert.equal(order.includes('probe'),failure!=='prepare');
});
