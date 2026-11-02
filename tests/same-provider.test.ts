import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveSelection} from '../src/selection.ts';
import {createAdapters,CodexAdapter} from '../src/adapters.ts';
import {Engine} from '../src/engine.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import {workflowAssessment} from '../src/discussion-workflow.ts';
import {usageSummary} from '../src/provider-runtime.ts';
import {historyPage,historyQuery} from '../src/saved-history.ts';
import {assertProvidersEnabled} from '../src/provider-config.ts';
import {providerFor} from '../src/participants.ts';
const choice={providers:['codex','codex-2'] as const,models:{codex:'model-a','codex-2':'model-b'}};

test('same-provider selection requires distinct explicit models and snapshots identity',()=>{
 const selected=resolveSelection(choice,choice);
 assert.deepEqual(selected,choice);assert.ok(Object.isFrozen(selected.models));
 for(const models of [{},{codex:'model-a'},{codex:'model-a','codex-2':'model-a'},{codex:'','codex-2':'model-b'}])assert.throws(()=>resolveSelection({providers:choice.providers,models},{providers:choice.providers,models:{}}),/different model IDs/);
 assert.throws(()=>resolveSelection({providers:['codex','codex-3'],models:{}},choice));
 assert.throws(()=>resolveSelection({providers:['codex','claude','codex-2','claude-2'],models:{}},choice));
 assert.deepEqual(createAdapters('real',choice.providers,choice.models).map(a=>a.id),choice.providers);
 const mixed={providers:['codex','codex-2','claude'] as const,models:{...choice.models,claude:'other'}};
 assert.deepEqual(resolveSelection(mixed,mixed),mixed);
 assert.deepEqual(resolveSelection({providers:['claude','claude-2'],models:{claude:'a','claude-2':'b'}},choice).providers,['claude','claude-2']);
});
test('provider-level disabling applies to every participant slot',t=>{
 const old=process.env.KOINOUS_DISABLED_PROVIDERS;t.after(()=>{if(old===undefined)delete process.env.KOINOUS_DISABLED_PROVIDERS;else process.env.KOINOUS_DISABLED_PROVIDERS=old;});
 process.env.KOINOUS_DISABLED_PROVIDERS='claude,grok';
 assert.doesNotThrow(()=>assertProvidersEnabled(choice.providers));
 assert.throws(()=>assertProvidersEnabled(['codex','claude-2']),/disabled/);
 assert.equal(providerFor('codex-2'),'codex');
});
test('two Codex SDK instances keep separate threads, models and usage with one login method',async()=>{
 const starts:string[]=[],calls:string[]=[];
 const load=async(options:any)=>{
  assert.equal(options.config.forced_login_method,'chatgpt');assert.equal(options.config.model_provider,'openai');assert.equal(options.apiKey,undefined);
  return {startThread(options:any){starts.push(options.model);const id='thread-'+options.model;return {id,async run(prompt:string){calls.push(id+':'+prompt);return {items:[],finalResponse:'offline answer',usage:{input_tokens:5,output_tokens:2,cached_input_tokens:0,cache_write_input_tokens:0,reasoning_output_tokens:0}};}};}};
 };
 const a=new CodexAdapter(load,'model-a'),b=new CodexAdapter(load,'model-b');
 const signal=new AbortController().signal;
 const replies=await Promise.all([a.run('a1',1,signal),b.run('b1',1,signal),]);
 await a.run('a2',2,signal);await b.run('b2',2,signal);
 assert.deepEqual(starts,['model-a','model-b']);assert.equal(new Set(replies.map(r=>r.sessionId)).size,2);
 assert.deepEqual(replies.map(r=>r.requestedModel),['model-a','model-b']);assert.ok(replies.every(r=>r.usage?.usd===null));
 assert.deepEqual(calls,['thread-model-a:a1','thread-model-b:b1','thread-model-a:a2','thread-model-b:b2']);
});
test('six offline replies preserve peer IDs, unknown costs and saved originals including second-model filtering',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'koinous-two-models-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const seen:Array<{id:string;round:number;prompt:string}>=[];
 const engine=new Engine(()=>choice.providers.map(id=>({id,async run(prompt:string,round:1|2|3){
  seen.push({id,round,prompt});const peer=id==='codex'?'codex-2':'codex';
  const response={peer,decision:'unresolved',reason:'Need workload evidence.'};
  const text=round===1?`Original analysis by ${id}`:JSON.stringify(round===2?{reviews:[response],revisedView:'Measure before deciding.',openQuestions:['Which workload?']}:{revisions:[response],direction:'pilot',recommendation:'Run a reversible pilot.',rationale:'Measure quality.',risks:['Unverified assumptions'],disagreements:['Workload is unknown.'],nextSteps:['Define test queries.'],claims:[]});
  return {text,requestedModel:choice.models[id],usage:{inputTokens:5,outputTokens:2,usd:null}};
 }})),dir);
 const s=engine.create('Synthetic retrieval idea',3,choice);await engine.run(s);
 assert.equal(s.status,'completed');assert.equal(s.calls,6);assert.equal(s.entries.length,6);assert.ok(s.entries.filter(e=>e.round>1).every(e=>e.validation?.status==='valid'));
 assert.equal(workflowAssessment(s).complete,true);assert.equal(s.outcome?.coverage.valid,2);assert.equal(s.outcome?.status,'direction-alignment');
 for(const row of seen){const peer=row.id==='codex'?'codex-2':'codex';if(row.round>1){assert.ok(row.prompt.includes(`Required lowercase peer IDs: ["${peer}"]`));assert.ok(row.prompt.includes(peer.toUpperCase()+':'));}else assert.match(row.prompt,/NONE. Respond independently/);}
 assert.equal(usageSummary(s.events).usd.missingCalls,6);assert.equal(usageSummary(s.events).inputTokens.known,30);
 assert.match(s.report!,/6 of 6 planned/);assert.match(s.report!,/codex-2/);assert.match(s.report!,/model-b/);assert.match(s.report!,/Codex cost: unknown/);
 const before=readFileSync(join(dir,s.id,'events.jsonl'));const saved=new SavedSessions(dir);const reopened=saved.load(s.id)!;
 assert.ok(reopened);assert.deepEqual(reopened.entries.map(e=>e.text),s.entries.map(e=>e.text));assert.equal(workflowAssessment(reopened).complete,true);assert.deepEqual(reopened.outcome,s.outcome);
 assert.deepEqual(readFileSync(join(dir,s.id,'events.jsonl')),before);
 const page=historyPage(saved.list().sessions,historyQuery(new URLSearchParams('provider=codex&model=model-b')),0,false);assert.equal(page.total,1);
 assert.equal(historyPage(saved.list().sessions,historyQuery(new URLSearchParams('provider=claude&model=model-b')),0,false).total,0);
});
test('duplicate-model defaults cannot dispatch an ambiguous discussion',()=>{
 assert.throws(()=>resolveSelection(undefined,{providers:choice.providers,models:{codex:'same','codex-2':'same'}}),/different model IDs/);
});
