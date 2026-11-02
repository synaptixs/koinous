import test from 'node:test';import assert from 'node:assert/strict';
import {parseProxyEvidence,AUTH_HOSTS} from '../scripts/grok-proxy-auth-preflight.ts';
test('authentication proxy evidence accepts only bounded-schema public counters',()=>{
 const data={attempts:1,successfulDials:1,tunneledBytes:100,resolvedHosts:['grok.com']};assert.deepEqual(parseProxyEvidence('KOINOUS_EGRESS '+JSON.stringify(data)),data);
 for(const change of [{secret:'private'}, {attempts:-1},{tunneledBytes:1.5},{resolvedHosts:['attacker.example']},{resolvedHosts:['grok.com', 'grok.com','grok.com','grok.com']},{successfulDials:'1'}])assert.equal(parseProxyEvidence('KOINOUS_EGRESS '+JSON.stringify({...data,...change})),undefined);
 assert.equal(parseProxyEvidence('raw private stderr'),undefined);assert.equal(parseProxyEvidence('KOINOUS_EGRESS {broken'),undefined);
 assert.ok(!AUTH_HOSTS.includes('api.x.ai'));assert.ok(Object.isFrozen(AUTH_HOSTS));
});
