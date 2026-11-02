import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveSelection, modelDefaults} from '../src/selection.ts';
const defaults={providers:['codex','claude'] as const,models:{codex:'codex-default',claude:'claude-default',grok:'grok-default'}};
for(const providers of [['codex','claude'],['codex','grok'],['claude','grok'],['codex','claude','grok']]) {
 test(`selection accepts ${providers.join(',')} and snapshots defaults`,()=>{
  const input={providers,models:{[providers[0]]:'model-custom'}};
  const s=resolveSelection(input,defaults);
  assert.deepEqual(s.providers,providers);assert.equal(s.models[providers[0] as keyof typeof s.models],'model-custom');
  input.models[providers[0]]='changed';assert.equal(s.models[providers[0] as keyof typeof s.models],'model-custom');
  assert.ok(Object.isFrozen(s));assert.ok(Object.isFrozen(s.providers));assert.ok(Object.isFrozen(s.models));
 });
}
for(const input of [null,[],{providers:['codex','claude'],models:null},{}, {providers:['codex']},{providers:['codex','codex']},{providers:['codex','gemini']},{providers:[{},'claude']},{providers:['codex','claude'],models:{grok:'model'}},{providers:['codex','claude'],models:[]},{providers:['codex','claude'],models:{codex:5}},{providers:['codex','claude'],models:{codex:'x'.repeat(129)}},{providers:['codex','claude'],models:{codex:'--api-key=secret'}},{providers:['codex','claude'],models:{codex:'model\nkey'}},{providers:['codex','claude'],apiKey:'synthetic'},{providers:['codex','claude'],transport:'api'}]) {
 test(`rejects invalid selection ${JSON.stringify(input)}`,()=>assert.throws(()=>resolveSelection(input,defaults)));
}
test('blank model uses configured default; omission uses roster defaults',()=>{
 assert.equal(resolveSelection({providers:['codex','claude'],models:{codex:''}},defaults).models.codex,'codex-default');
 assert.deepEqual(resolveSelection(undefined,defaults).providers,defaults.providers);
 assert.deepEqual(modelDefaults({}),{codex:'',claude:'',grok:'grok-4.7'});
});
