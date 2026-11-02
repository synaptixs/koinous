import test from 'node:test';import assert from 'node:assert/strict';
import {grokEgressHosts} from '../src/grok-egress-config.ts';
import {GrokVMLifecycle} from '../src/grok-vm-lifecycle.ts';
test('Grok egress policy accepts only explicit exact hosts and freezes a private copy',()=>{
 const hosts=['approved.example'];const accepted=grokEgressHosts(hosts);hosts.push('other.example');assert.deepEqual(accepted,['approved.example']);assert.ok(Object.isFrozen(accepted));
 assert.deepEqual(grokEgressHosts([]),[]);
 for(const invalid of [['*.example'],['127.0.0.1'],['approved.example:443'],['https://approved.example'],['UPPER.example'],['approved.example','approved.example'],'approved.example',null])assert.throws(()=>grokEgressHosts(invalid));
});
test('managed connection snapshots its own allowlist without ambient fallback',()=>{
 const old=process.env.GROK_BUILD_EGRESS_HOSTS;process.env.GROK_BUILD_EGRESS_HOSTS='["ambient.example"]';
 try{
 const hosts=['approved.example'],config={podman:'/fixture/podman',authHome:'/fixture/auth',binary:'/fixture/grok',image:'/fixture/image',imageSha256:'a'.repeat(64),stateDir:'/fixture/state'};
 const runtime=new GrokVMLifecycle({...config,egressHosts:hosts});hosts.push('changed.example');assert.deepEqual(runtime.connection.egressHosts,['approved.example']);assert.ok(Object.isFrozen(runtime.connection.egressHosts));
 assert.deepEqual(new GrokVMLifecycle(config).connection.egressHosts,[]);
 }finally{if(old===undefined)delete process.env.GROK_BUILD_EGRESS_HOSTS;else process.env.GROK_BUILD_EGRESS_HOSTS=old;}
});
