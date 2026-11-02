import test from 'node:test';
import assert from 'node:assert/strict';
import {infrastructurePreflight} from '../scripts/grok-managed-infra-preflight.ts';
for(const failure of ['none','prepare','dispose'])test(`infrastructure-only preflight ${failure}: never needs a model adapter or real credential`,async()=>{
 const order:string[]=[];
 const runtime={async prepare(){order.push('prepare');if(failure==='prepare')throw Error('prepare failure');},assertReady(){order.push('verify');},async dispose(){order.push('dispose');if(failure==='dispose')throw Error('cleanup failure');}};
 const work=infrastructurePreflight(runtime,new AbortController().signal);
 if(failure==='none')await work;else await assert.rejects(work);
 assert.deepEqual(order,failure==='prepare'?['prepare','dispose']:['prepare','verify','dispose']);
});
