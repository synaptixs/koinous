import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/engine.ts';
import {createAdapters} from '../src/adapters.ts';
test('actual mock adapters complete nine replies and yield a usable idea recommendation without inference',async t=>{
 const root=mkdtempSync(join(tmpdir(),'koinous-mock-idea-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const engine=new Engine(()=>createAdapters('mock'),root);const s=engine.create('Try a four-day week',3,undefined,{context:'Keep support coverage',budget:{maxCalls:9,maxTokens:1}});await engine.run(s);
 assert.equal(s.budget?.policy.maxTokens,1);assert.equal(s.budget?.chargedTokens,0);assert.equal(s.budget?.reservedTokens,0);assert.equal(s.calls,9);assert.equal(s.status,'completed');assert.equal(s.outcome?.coverage.valid,3);assert.equal(s.outcome?.status,'direction-alignment');assert.match(s.outcome!.recommendation,/four-day week/);assert.equal(s.evidence,undefined);assert.equal(s.spendKnownUSD,0);assert.ok(s.outcome!.unresolved.length);assert.match(s.report!,/Final recommendation/);assert.equal(s.outcome?.claimAssessment?.declaredBy.length,3);assert.ok(s.outcome?.claimAssessment?.checks.every(c=>c.status==='assumption'));assert.match(s.report!,/not independently verified/);
});
