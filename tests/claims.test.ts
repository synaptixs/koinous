import test from 'node:test';
import assert from 'node:assert/strict';
import {parseClaims,assessClaims} from '../src/claims.ts';
import type {Claim} from '../src/claims.ts';
import type {Evidence} from '../src/core.ts';
const fact:Claim={id:'c1',kind:'fact',text:'The trial improved delivery.',evidenceIds:['E1'],snapshotId:'rev-1'};
const evidence:Evidence={snapshotId:'rev-1',hash:'test',source:'file',items:[{id:'E1',uri:'synthetic:1',text:'Delivery was not measured.'}]};
test('reference validity never certifies factual support, even for contradictory evidence',()=>{
 const [c]=assessClaims('codex',[fact],evidence);assert.equal(c.status,'reference-valid-unverified');assert.match(c.issues.join(' '),/independent review/);
});
test('missing evidence, invalid IDs, revisions and ambiguous IDs stay explicit',()=>{
 for(const [claim,source,reason] of [
  [{...fact,evidenceIds:[],snapshotId:null},undefined,/no evidence references/],
  [fact,undefined,/No evidence snapshot/],
  [{...fact,snapshotId:'rev-2'},evidence,/mismatched snapshot/],
  [{...fact,snapshotId:null},evidence,/mismatched snapshot/],
  [{...fact,evidenceIds:['E2']},evidence,/not found/],
  [fact,{...evidence,items:[...evidence.items,...evidence.items]},/ambiguous/],
 ] as Array<[Claim,Evidence|undefined,RegExp]>){const [c]=assessClaims('claude',[claim],source);assert.equal(c.status,'unsupported');assert.match(c.issues.join(' '),reason);}
});
test('assumptions and proposals remain distinct from facts',()=>{
 const claims:Claim[]=['assumption','proposal'].map(kind=>({...fact,kind:kind as Claim['kind'],evidenceIds:[],snapshotId:null}));
 assert.deepEqual(assessClaims('grok',claims).map(c=>c.status),['assumption','proposal']);
 assert.equal(assessClaims('grok',[{...fact,kind:'assumption'}],evidence)[0].status,'unsupported');
});
test('strict bounded claim schema rejects ambiguity and silent truncation',()=>{
 assert.deepEqual(parseClaims([{...fact,text:'x'.repeat(601)}])?.[0].text,'x'.repeat(601));
 assert.deepEqual(parseClaims([]),[]);assert.deepEqual(parseClaims([fact]),[fact]);
 for(const value of [null,{},[fact,fact],Array.from({length:9},(_,i)=>({...fact,id:'c'+i})),[{...fact,confidence:1}],[{...fact,kind:'verified'}],[{...fact,text:' '}],[{...fact,evidenceIds:['E1','E1']}],[{...fact,evidenceIds:[1]}],[{...fact,snapshotId:4}],[{...fact,id:'bad id'}]])assert.equal(parseClaims(value),null);
});
test('claim checks are deterministic and do not mutate the input',()=>{
 const before=JSON.stringify({fact,evidence});assert.deepEqual(assessClaims('codex',[fact],evidence),assessClaims('codex',[fact],evidence));assert.equal(JSON.stringify({fact,evidence}),before);
});

test('stored assessment shape is bounded and rejects malformed or ambiguous claim coverage',async()=>{
 const {validClaimAssessment}=await import('../src/claims.ts');
 const a={version:1,scope:'Declared claims only.',declaredBy:['codex'],unassessed:['claude'],checks:assessClaims('codex',[fact],evidence)};
 assert.equal(validClaimAssessment(a),true);
 for(const bad of [{...a,version:2},{...a,checks:null},{...a,declaredBy:['codex','codex']},{...a,unassessed:['codex']},{...a,checks:[...a.checks,...a.checks]},{...a,checks:[{...a.checks[0],status:'verified'}]},{...a,checks:[{...a.checks[0],issues:[4]}]},{...a,checks:[{...a.checks[0],agent:'grok'}]}])assert.equal(validClaimAssessment(bad),false);
});
