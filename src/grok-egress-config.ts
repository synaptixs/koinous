import {approvedHosts} from './worker-egress.ts';
// Trusted deployment configuration only. Empty means deny-all, never infer hosts.
export function grokEgressHosts(value:unknown=JSON.parse(process.env.GROK_BUILD_EGRESS_HOSTS||'[]')):readonly string[]{
 if(!Array.isArray(value))throw Error('Grok egress hosts must be a JSON array');
 return Object.freeze([...approvedHosts(value)]);
}
