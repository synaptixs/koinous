import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveSelection} from '../src/selection.ts';
import {createAdapters} from '../src/adapters.ts';
import {participantEffort} from '../src/reasoning.ts';
import {normalizeCatalog} from '../src/model-catalog.ts';
import {OllamaAdapter,ollamaReasoning} from '../src/ollama.ts';
import {Engine} from '../src/engine.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import {makeReport} from '../src/core.ts';
import type {ThreadOptions} from '@openai/codex-sdk';
import type {Options} from '@anthropic-ai/claude-agent-sdk';
const models={codex:'test-codex',claude:'test-claude'};
const roster=['codex','claude'] as const;
const json=(value:unknown)=>new Response(JSON.stringify(value));

test('effort maps snapshot and freeze independent choices while omission preserves legacy behavior',()=>{
 const input={providers:roster,models,efforts:{codex:'xhigh',claude:'max'}};const s=resolveSelection(input);input.efforts.codex='low';assert.deepEqual(s.efforts,{codex:'xhigh',claude:'max'});assert.ok(Object.isFrozen(s.efforts));
 const legacy=resolveSelection({providers:roster,models});assert.equal(legacy.efforts,undefined);assert.equal(participantEffort(legacy,'claude','low'),'low');assert.equal(participantEffort(legacy,'codex'),null);
 const explicit=resolveSelection({providers:roster,models,efforts:{codex:null,claude:'medium'}});assert.equal(participantEffort(explicit,'codex','high'),null);
 const same=resolveSelection({providers:['codex','codex-2'],models:{codex:'a','codex-2':'b'},efforts:{codex:'low','codex-2':'high'}});assert.equal(same.efforts?.['codex-2'],'high');
});
for(const efforts of [null,[],{grok:'high'},{codex:'invented'},{claude:'ultra'},{codex:true},{claude:1},{codex:{level:'high'}}])test('reject invalid effort overrides '+JSON.stringify(efforts),()=>assert.throws(()=>resolveSelection({providers:roster,models,efforts})));

test('factory-created SDK adapters send selected levels independently, including explicit provider default',async()=>{
 for(const [choices,expected] of [[{codex:'xhigh',claude:'max'},['xhigh','max']],[{codex:null,claude:null},[undefined,undefined]]] as const){
  const adapters=createAdapters('real',roster,models,'low','low',false,choices);const observed:unknown[]=[];
  // Replace SDK I/O on the real factory-created adapters; no CLI/model starts.
  Object.assign(adapters[0],{load:async()=>({startThread(options:ThreadOptions){observed[0]=options.modelReasoningEffort;return {id:'test',async run(){return {items:[],finalResponse:'Answer',usage:null};}};}})});
  Object.assign(adapters[1],{load:async()=>({options}:{options:Options})=>{observed[1]=options.effort;return Object.assign((async function*(){yield {type:'result',subtype:'success',is_error:false,result:'Answer',uuid:'test',session_id:'test',modelUsage:{},total_cost_usd:0};})(),{close(){}});}});
  for(const adapter of adapters)await adapter.run('Synthetic offline input',1,new AbortController().signal);
  assert.deepEqual(observed,expected);
 }
});

test('catalogs retain model-reported efforts and explicit unsupported controls without inventing levels',()=>{
 const codex=normalizeCatalog('codex',[{model:'a',supportedReasoningEfforts:[{reasoningEffort:'medium'},{reasoningEffort:'xhigh'},{reasoningEffort:'unknown'}]},{model:'b'}]);assert.deepEqual(codex.efforts,{a:['medium','xhigh']});
 const claude=normalizeCatalog('claude',[{value:'a',supportsEffort:true,supportedEffortLevels:['low','medium','max']},{value:'b',supportsEffort:false},{value:'c'}]);assert.deepEqual(claude.efforts,{a:['low','medium','max'],b:[]});
});

for(const effort of ['medium',false,true,null] as const)test('Ollama validates and forwards exact thinking control '+effort,async()=>{
 const bodies:Array<Record<string,unknown>>=[];const load:typeof fetch=async(_url,options)=>{const body=JSON.parse(String(options?.body));bodies.push(body);return json(bodies.length===1?{capabilities:['completion'],thinking:{values:['low','medium','high',true,false]}}:{done:true,done_reason:'stop',message:{content:'Answer'},prompt_eval_count:3,eval_count:2});};
 const adapter=new OllamaAdapter('ollama-local','a',load,'http://127.0.0.1:11434',effort);await adapter.run('Q',1,new AbortController().signal);
 assert.equal(bodies[1].think,effort===null?undefined:effort);assert.equal(bodies[1].stream,false);
});

test('Ollama metadata is read-only and unsupported or changed effort fails before chat rather than defaulting',async()=>{
 const paths:string[]=[];const load:typeof fetch=async(url)=>{paths.push(String(url));return json({capabilities:['completion'],thinking:{values:['low','medium','high']}});};
 assert.deepEqual((await ollamaReasoning('ollama-local','a',load)).values,['low','medium','high']);assert.ok(paths.every(path=>path.endsWith('/api/show')));
 const unsupported=new OllamaAdapter('ollama-local','a',load,undefined,'deep');await assert.rejects(unsupported.run('Q',1,new AbortController().signal),/not reported/);assert.ok(paths.every(path=>path.endsWith('/api/show')));
 let reads=0;const changed=new OllamaAdapter('ollama-local','a',async url=>{assert.ok(String(url).endsWith('/api/show'));return json({capabilities:['completion'],thinking:{values:++reads===1?['medium']:['low']}});},undefined,'medium');await changed.prepare(new AbortController().signal);await assert.rejects(changed.run('Q',1,new AbortController().signal),/not reported/);
});

test('full discussion stores requested effort and reopens it unchanged in selection, entries and Markdown',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'synqo-effort-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const selection=resolveSelection({providers:roster,models,efforts:{codex:'high',claude:'medium'}});
 const engine=new Engine(()=>roster.map(id=>({id,async run(){return {text:'Synthetic answer',usage:{inputTokens:1,outputTokens:1,usd:0}};}})),dir);const s=engine.create('Test effort',1,selection);await engine.run(s);
 assert.deepEqual(s.entries.map(e=>e.requestedEffort),['high','medium']);const saved=new SavedSessions(dir).load(s.id)!;assert.deepEqual(saved.selection?.efforts,selection.efforts);assert.deepEqual(saved.entries.map(e=>e.requestedEffort),['high','medium']);assert.match(makeReport(saved),/Requested reasoning/);assert.match(makeReport(saved),/codex.*high/);
});
