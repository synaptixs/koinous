import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Engine} from '../src/engine.ts';
import type {Adapter,Reply,Session,Usage,Evidence} from '../src/core.ts';
import {createApplication} from '../src/server.ts';
import {SavedSessions} from '../src/saved-sessions.ts';
import {ProviderFailure} from '../src/provider-runtime.ts';
import {tokenAccounting,modelAccounting} from '../src/token-accounting.ts';
import {parseDraftText,parseTargetedReview,parseRevision,materialFindings,targetedPrompt,targetedMarkdown} from '../src/targeted-review.ts';
import type {Draft,Finding} from '../src/targeted-review.ts';
const draft:Draft={recommendation:'Key the cache by commit.',rationale:'Assume commits identify analysis inputs; no cache is the alternative.',claims:[{id:'c1',kind:'assumption',text:'Commit is sufficient.'}],risks:['Dirty contents may differ.'],nextSteps:['Owner: compare cached and fresh outputs; stop on mismatch.']};
const fixed:Draft={...draft,recommendation:'Key exact immutable inputs including dirty contents, commit, version and configuration.',claims:[{id:'c1',kind:'proposal',text:'Analyze the same immutable snapshot used in the key.'}]};
const finding:Finding={id:'f1',claimId:'c1',severity:'material',category:'correctness',failureScenario:'Two dirty edits at the same commit reuse one key.',consequence:'Wrong analysis result.',correction:'Include the exact source snapshot, config and analyzer version.',acceptanceTest:'At one commit, analyze dirty A then dirty B and compare each result with fresh analysis.'};
const review={summary:'Commit-only key is unsafe.',findings:[finding]};
const response={findingId:'f1',decision:'addressed',reason:'Dirty contents affect results.',change:'Key on the complete immutable input snapshot.'};
const selection={providers:['claude','codex'] as const,models:{claude:'claude-sonnet-5-5',codex:'gpt-6-astra'}};
function root(t:test.TestContext){const p=mkdtempSync(join(tmpdir(),'targeted-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function fixture(t:test.TestContext,values:unknown[]=[draft,review,{draft:fixed,responses:[response]}],opts:{errorRound?:number;missing?:boolean;cleanupFailure?:boolean;maxCalls?:number}={}){
 const dir=root(t),requests:Array<{prompt:string;round:number;instance:number}>=[],prepared:number[]=[],cleaned:number[]=[];let factoryCalls=0;
 const engine=new Engine(()=>{const instance=++factoryCalls;return selection.providers.map(id=>({id,async prepare(){prepared.push(instance);},async dispose(){cleaned.push(instance);if(opts.cleanupFailure)throw Error('cleanup');},async run(prompt,round){requests.push({prompt,round,instance});
  if(opts.errorRound===round)throw new ProviderFailure('provider_error','failure',{usage:{inputTokens:7,outputTokens:2}});
  const usage:Usage|undefined=opts.missing?undefined:{inputTokens:110,outputTokens:20,cacheReadTokens:30,reasoningTokens:5,usd:null};
  return {text:JSON.stringify(values[round-1]),usage,accounting:{primary:{inputTokens:90,outputTokens:15},auxiliary:{haiku:{inputTokens:20,outputTokens:5}},unclassified:{},auxiliaryVisibility:'reported'}};
 }}));},dir);
 const s=engine.create('Cache policy',3,selection,{workflowMode:'targeted',author:'claude',context:'Dirty edits change results.',checks:['Different dirty contents must not reuse stale results.'],budget:{maxCalls:opts.maxCalls??3}});
 return {dir,engine,s,requests,prepared,cleaned,get factoryCalls(){return factoryCalls;}};
}
test('material finding triggers exactly one fresh revision, preserves inputs, original and actual field changes',async t=>{
 const f=fixture(t);await f.engine.run(f.s);
 assert.equal(f.s.status,'completed');assert.equal(f.s.calls,3);assert.equal(f.factoryCalls,3);assert.deepEqual(f.cleaned,[1,2,3]);
 assert.deepEqual(f.requests.map(r=>r.instance),[1,2,3]);assert.deepEqual(f.requests.map(r=>r.round),[1,2,3]);
 for(const r of f.requests){assert.match(r.prompt,/Dirty edits change results/);assert.match(r.prompt,/Different dirty contents/);assert.doesNotMatch(r.prompt,/YOUR PRIOR POSITION|OTHER AGENTS LAST ROUND/);}
 assert.match(f.requests[1].prompt,/Commit is sufficient/);assert.doesNotMatch(f.requests[2].prompt,/Commit-only key is unsafe/); // Review summary/history is not replayed.
 assert.deepEqual(f.s.targeted?.draft,draft);assert.deepEqual(f.s.targeted?.final,fixed);assert.deepEqual(f.s.targeted?.changedFields,['recommendation','claims']);assert.equal(f.s.targeted?.complete,true);
 const a=tokenAccounting(f.s.events);assert.equal(a.knownTotalTokens,390);assert.equal(a.calls[0].primaryTokens,105);assert.equal(a.calls[0].auxiliaryTokens,25);
 assert.match(f.s.report!,/Cache policy/);assert.match(f.s.report!,/Dirty edits change results/);assert.match(f.s.report!,/Different dirty contents/);assert.match(f.s.report!,/claude-sonnet-5-5/);assert.match(f.s.report!,/390 known total tokens/);assert.match(f.s.report!,/f1.*addressed/);
 assert.throws(()=>f.engine.intervene(f.s,'Change task'),/fixed inputs/);
});
for(const [label,findings] of [['no finding',[]],['cosmetic finding',[{...finding,severity:'cosmetic'}]],['style-only material label',[{...finding,category:'style'}]]] as const){
 test(`${label} stops at two calls and keeps the exact draft`,async t=>{
  const f=fixture(t,[fixed,{summary:'Reviewed.',findings}]);await f.engine.run(f.s);assert.equal(f.s.calls,2);assert.equal(f.factoryCalls,2);assert.equal(f.s.status,'completed');assert.deepEqual(f.s.targeted?.final,fixed);assert.equal(f.s.targeted?.revision,'not-needed');assert.deepEqual(f.s.targeted?.changedFields,[]);
 });
}
for(const decision of ['rejected','unresolved'] as const)test(`${decision} finding remains explicit without claiming a fix`,async t=>{
 const f=fixture(t,[draft,review,{draft,responses:[{...response,decision,change:'',reason:'Evidence does not establish this correction.'}]}]);await f.engine.run(f.s);
 assert.equal(f.s.status,'completed');assert.equal(f.s.targeted?.responses[0].decision,decision);assert.deepEqual(f.s.targeted?.changedFields,[]);assert.deepEqual(f.s.targeted?.final,draft);
});
test('malformed or unreferenced reviews stop without repair or automatic revision',async t=>{
 for(const r of [{summary:'Bad',findings:[{...finding,claimId:'unknown'}]},{summary:'Bad',findings:[{...finding,correction:''}]},{summary:'Bad',findings:[finding,finding]}, {summary:'Bad',findings:[finding,finding,finding,finding]}]){
  const f=fixture(t,[draft,r]);await f.engine.run(f.s);assert.equal(f.s.calls,2);assert.equal(f.s.status,'partial');assert.equal(f.s.targeted?.complete,false);assert.deepEqual(f.s.targeted?.final,draft);assert.equal(f.cleaned.length,2);
 }
});
test('missing, duplicate, or false addressed revision responses remain incomplete',async t=>{
 for(const revision of [{draft:fixed,responses:[]},{draft:fixed,responses:[response,response]},{draft,responses:[response]}]){
  const f=fixture(t,[draft,review,revision]);await f.engine.run(f.s);assert.equal(f.s.calls,3);assert.equal(f.s.status,'partial');assert.deepEqual(f.s.targeted?.final,draft);assert.equal(f.s.targeted?.revision,'unavailable');
 }
});
test('failure retains usage, stops subsequent calls and always cleans the dispatched adapter',async t=>{
 const f=fixture(t,undefined,{errorRound:2});await f.engine.run(f.s);assert.equal(f.s.calls,2);assert.equal(f.s.status,'failed');assert.equal(f.cleaned.length,2);assert.equal(tokenAccounting(f.s.events).knownTotalTokens,139);assert.equal(f.s.targeted?.complete,false);
});
test('missing usage stays unknown, cleanup failure stops, and call budget blocks revision',async t=>{
 const missing=fixture(t,[draft,{summary:'Fine',findings:[]}],{missing:true});await missing.engine.run(missing.s);assert.equal(tokenAccounting(missing.s.events).missingCalls,2);assert.equal(tokenAccounting(missing.s.events).calls[0].totalTokens,null);
 const cleanup=fixture(t,undefined,{cleanupFailure:true});await cleanup.engine.run(cleanup.s);assert.equal(cleanup.s.status,'failed');assert.equal(cleanup.s.calls,1);
 const budget=fixture(t,undefined,{maxCalls:2});await budget.engine.run(budget.s);assert.equal(budget.s.calls,2);assert.equal(budget.s.status,'partial');assert.equal(budget.s.targeted?.revision,'unavailable');
});
test('cancellation before or between stages never dispatches another call',async t=>{
 const before=fixture(t);before.engine.cancel(before.s);await before.engine.run(before.s);assert.equal(before.s.calls,0);assert.equal(before.s.status,'cancelled');
 const between=fixture(t);between.engine.on(between.s.id,e=>{if(e.type==='agent.completed')between.engine.cancel(between.s);});await between.engine.run(between.s);assert.equal(between.s.calls,1);assert.equal(between.s.status,'cancelled');
});
test('strict bounds reject oversized schema fields, excess claims and unknown keys without clipping',()=>{
 assert.equal(parseDraftText(JSON.stringify({...draft,recommendation:'x'.repeat(1001)})),null);
 assert.equal(parseDraftText(JSON.stringify({...draft,claims:[...draft.claims,...draft.claims]})),null);
 assert.equal(parseDraftText(JSON.stringify({...draft,extra:true})),null);
 assert.equal(parseTargetedReview(JSON.stringify({...review,findings:[{...finding,acceptanceTest:'x'.repeat(401)}]}),draft),null);
 assert.equal(parseRevision(JSON.stringify({draft:fixed,responses:[{...response,findingId:'other'}]}),draft,[finding]),null);
 assert.equal(materialFindings(review).length,1);
});
test('targeted config rejects unsupported rosters, bad roles and invalid checks before a call',t=>{
 const e=new Engine(()=>{throw Error('No adapters');},root(t));
 for(const options of [{author:'grok'},{checks:['']},{checks:Array(7).fill('check')},{workflowMode:'other'}])assert.throws(()=>e.create('Task',3,selection,{workflowMode:'targeted',...options}));
 assert.throws(()=>e.create('Task',3,{providers:['codex','grok'],models:{codex:'a',grok:'b'}},{workflowMode:'targeted'}),/exactly two/);
});
test('persisted targeted sessions reopen with identical accounting and exports and no adapter calls',async t=>{
 const f=fixture(t);await f.engine.run(f.s);const path=join(f.dir,f.s.id,'events.jsonl'),bytes=readFileSync(path);
 const app=createApplication({mode:'real',outputDir:f.dir,adapterFactory:()=>{throw Error('No inference');}});
 const request=async(path:string)=>{let status=0,text='';const req=Object.assign(Readable.from([]),{url:path,method:'GET',headers:{}}),res={writeHead(code:number){status=code;return this;},end(chunk?:string){text+=chunk||'';}};await app.handler(req as unknown as IncomingMessage,res as unknown as ServerResponse);return {status,text};};
 const reopened=await request('/api/sessions/'+f.s.id);assert.equal(reopened.status,200);const data=JSON.parse(reopened.text);assert.deepEqual(data.targeted,f.s.targeted);assert.equal(data.workflow,null);assert.equal(data.tokenAccounting.knownTotalTokens,390);
 const exported=JSON.parse((await request('/api/sessions/'+f.s.id+'/report?format=json')).text);assert.deepEqual(exported.tokenAccounting,data.tokenAccounting);assert.deepEqual(exported.targeted,data.targeted);assert.equal(exported.entries.length,3);
 assert.match((await request('/api/sessions/'+f.s.id+'/report')).text,/Per-call token accounting/);assert.deepEqual(readFileSync(path),bytes);
 const events=bytes.toString().trim().split('\n').map(l=>JSON.parse(l));events.find(e=>e.type==='targeted.assessed').targeted.final.recommendation='Tampered';writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n'));assert.equal(new SavedSessions(f.dir).load(f.s.id),undefined);
 await app.shutdown();
});
test('accounting distinguishes unknown helpers from zero and never double-counts cache/reasoning',()=>{
 const a=tokenAccounting([{seq:1,at:'',type:'agent.completed',agent:'codex',round:1,usage:{inputTokens:100,outputTokens:10,cacheReadTokens:90,reasoningTokens:5}}]);assert.equal(a.knownTotalTokens,110);assert.equal(a.calls[0].auxiliaryTokens,null);assert.equal(a.calls[0].primaryTokens,null);
 const b=modelAccounting('wanted',[],{other:{inputTokens:10,outputTokens:2},'claude-haiku-5-5':{inputTokens:3,outputTokens:1}});assert.equal(b.primary,null);assert.equal(Object.keys(b.unclassified).length,1);assert.equal(Object.keys(b.auxiliary).length,1);
 const malformed=tokenAccounting([{seq:1,at:'',type:'agent.completed',accounting:{},usage:{inputTokens:10,outputTokens:2}}]);assert.equal(malformed.calls[0].primaryTokens,null);assert.equal(malformed.knownTotalTokens,12);
});
test('API forwards per-stage effort and fresh-context settings and preserves the three-call decision',async t=>{
 const options:Array<{effort:unknown;claudeEffort:unknown;decisionOnly:unknown}>=[],executed:string[]=[];
 const app=createApplication({mode:'mock',outputDir:root(t),adapterFactory:(_m,ids,_models,effort,claudeEffort,decisionOnly)=>{options.push({effort,claudeEffort,decisionOnly});return (ids??[]).map(id=>({id,async run(_prompt,round){executed.push(id);return {text:JSON.stringify([draft,review,{draft:fixed,responses:[response]}][round-1]),usage:{inputTokens:1,outputTokens:1}};}}));}});
 const req=Object.assign(Readable.from([JSON.stringify({prompt:'Cache policy',selection,workflowMode:'targeted',author:'claude',checks:['Different edits have different input identities']})]),{url:'/api/sessions',method:'POST',headers:{}});let status=0;
 await app.handler(req as unknown as IncomingMessage,{writeHead(code:number){status=code;},end(){}} as unknown as ServerResponse);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(status,201);assert.deepEqual(executed,['claude','codex','claude']);assert.deepEqual(options.slice(1),[{effort:'low',claudeEffort:'low',decisionOnly:true},{effort:'medium',claudeEffort:'medium',decisionOnly:true},{effort:'low',claudeEffort:'low',decisionOnly:true}]);assert.equal([...app.engine.sessions.values()][0].targeted?.complete,true);await app.shutdown();
});
test('real targeted API remains blocked while inference is disabled',async t=>{
 const old=process.env.KOINOUS_ENABLE_INFERENCE;process.env.KOINOUS_ENABLE_INFERENCE='0';t.after(()=>{if(old===undefined)delete process.env.KOINOUS_ENABLE_INFERENCE;else process.env.KOINOUS_ENABLE_INFERENCE=old;});
 let calls=0;const app=createApplication({mode:'real',outputDir:root(t),adapterFactory:(_m,ids)=> (ids??[]).map(id=>({id,async run(){calls++;return {text:'unexpected'};}}))});
 const req=Object.assign(Readable.from([JSON.stringify({prompt:'Task',selection,workflowMode:'targeted'})]),{url:'/api/sessions',method:'POST',headers:{}});let status=0;
 await app.handler(req as unknown as IncomingMessage,{writeHead(code:number){status=code;},end(){}} as unknown as ServerResponse);assert.equal(status,400);assert.equal(calls,0);assert.equal(app.engine.sessions.size,0);await app.shutdown();
});
test('partial failed-call usage contributes every known counter without inventing missing usage',()=>{
 const a=tokenAccounting([{seq:1,at:'',type:'agent.error',agent:'codex',round:2,usage:{inputTokens:19}}, {seq:2,at:'',type:'agent.completed',agent:'claude',round:1,usage:{outputTokens:7}}]);
 assert.equal(a.knownTotalTokens,26);assert.equal(a.missingCalls,2);assert.equal(a.calls[0].totalTokens,null);assert.equal(a.calls[0].outputTokens,null);assert.equal(a.calls[1].inputTokens,null);
});
test('targeted review refuses a budget that cannot fund the minimum two calls',t=>{
 const e=new Engine(()=>{throw Error('No adapter construction');},root(t));
 assert.throws(()=>e.create('Task',3,selection,{workflowMode:'targeted',budget:{maxCalls:1}}),/two calls/);
});
test('aggregate response limits are communicated and also apply to nested revised drafts',t=>{
 const f=fixture(t);assert.match(targetedPrompt(f.s,'draft'),/6000/);assert.match(targetedPrompt(f.s,'review',draft),/7000/);assert.match(targetedPrompt(f.s,'revision',draft,review),/9000/);
 const large={...draft,recommendation:'x'.repeat(1000),rationale:'x'.repeat(1000),risks:Array(4).fill('x'.repeat(300)),nextSteps:Array(4).fill('x'.repeat(300)),claims:Array.from({length:6},(_,i)=>({id:'c'+i,kind:'assumption',text:'x'.repeat(400)}))};
 assert.equal(parseRevision(JSON.stringify({draft:large,responses:[response]}),draft,[finding]),null);
});
test('research snapshot and request survive restart and stay in self-contained exports without retrieval',async t=>{
 const dir=root(t),evidence:Evidence={source:'web',snapshotId:'research-test',hash:'fixed-hash',items:[{id:'wiki-1',uri:'https://en.wikipedia.org/?curid=1',text:'A synthetic research excerpt.'}]};
 let retrievals=0;
 const engine=new Engine(()=>selection.providers.map(id=>({id,async run(_p,round){return {text:JSON.stringify(round===1?fixed:{summary:'No material issue',findings:[]}),usage:{inputTokens:0,outputTokens:0}};}})),dir,async()=>{retrievals++;return evidence;});
 const s=engine.create('Synthetic question',3,selection,{workflowMode:'targeted',author:'claude',research:{mode:'wikipedia',query:'Synthetic query'}});await engine.run(s);
 assert.equal(retrievals,1);assert.deepEqual(new SavedSessions(dir).load(s.id)?.evidence,evidence);assert.deepEqual(new SavedSessions(dir).load(s.id)?.research,s.research);
 const app=createApplication({mode:'real',outputDir:dir,adapterFactory:()=>{throw Error('No providers');}});
 for(const suffix of ['', '/report', '/report?format=json']){
  let status=0,body='';await app.handler(Object.assign(Readable.from([]),{url:'/api/sessions/'+s.id+suffix,method:'GET',headers:{}}) as unknown as IncomingMessage,{writeHead(code:number){status=code;},end(value?:string){body+=value||'';}} as unknown as ServerResponse);
  assert.equal(status,200);if(suffix)assert.match(body,/A synthetic research excerpt/);else assert.deepEqual(JSON.parse(body).research,s.research);
 }
 assert.equal(retrievals,1);await app.shutdown();
});
test('targeted Markdown surfaces final risks and claims without relying on raw JSON',async t=>{
 const f=fixture(t);await f.engine.run(f.s);const text=targetedMarkdown(f.s.targeted!).join('\n');assert.match(text,/### Risks/);assert.match(text,/### Declared claims/);assert.match(text,/c1.*proposal/);
});
test('configured evidence is pinned across restart even after its source file changes',async t=>{
 const dir=root(t),file=join(dir,'evidence.json');writeFileSync(file,JSON.stringify({snapshotId:'synthetic',items:[{id:'ref1',uri:'fixture://original',text:'Original source facts.'}]}));
 const envKeys=['EVIDENCE_FILE','MCP_SERVER_URL','PKG_MANIFEST_FILE','PKG_MANIFEST_SHA256','MCP_SNAPSHOT_ID'] as const;
 const before=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));for(const k of envKeys)delete process.env[k];process.env.EVIDENCE_FILE=file;
 t.after(()=>{for(const k of envKeys)if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];});
 const engine=new Engine(()=>selection.providers.map(id=>({id,async run(_p,round){return {text:JSON.stringify(round===1?fixed:{summary:'No issues',findings:[]})};}})),dir);
 const s=engine.create('Task',3,selection,{workflowMode:'targeted',author:'claude',grounding:'configured'});await engine.run(s);assert.equal(s.status,'completed');
 writeFileSync(file,'Changed source, no longer JSON.');const restored=new SavedSessions(dir).load(s.id)!;assert.deepEqual(restored.evidence,s.evidence);assert.equal(restored.evidence?.items[0].text,'Original source facts.');
});

test('explicit per-participant efforts survive API dispatch, author revision, saved restore and exports',async t=>{
 const configured={...selection,efforts:{claude:'high',codex:'max'}};const calls:Array<unknown>=[];
 const dir=root(t);const app=createApplication({mode:'mock',outputDir:dir,adapterFactory:(_m,ids,_models,_effort,_claudeEffort,_decisionOnly,efforts)=>{calls.push(efforts);return (ids??[]).map(id=>({id,async run(_prompt,round){return {text:JSON.stringify([draft,review,{draft:fixed,responses:[response]}][round-1]),usage:{inputTokens:1,outputTokens:1}};}}));}});
 const req=Object.assign(Readable.from([JSON.stringify({prompt:'Cache policy',selection:configured,workflowMode:'targeted',author:'claude'})]),{url:'/api/sessions',method:'POST',headers:{}});let status=0;
 await app.handler(req as unknown as IncomingMessage,{writeHead(code:number){status=code;},end(){}} as unknown as ServerResponse);await new Promise(resolve=>setImmediate(resolve));assert.equal(status,201);assert.ok(calls.length>=4);assert.ok(calls.every(value=>JSON.stringify(value)===JSON.stringify(configured.efforts)));
 const s=[...app.engine.sessions.values()][0];assert.deepEqual(s.entries.map(e=>e.requestedEffort),['high','max','high']);assert.match(s.report!,/Author: claude \(high effort\).*Reviewer: codex \(max effort\)/);const reopened=new SavedSessions(dir).load(s.id)!;assert.deepEqual(reopened.selection?.efforts,configured.efforts);assert.deepEqual(reopened.entries.map(e=>e.requestedEffort),['high','max','high']);await app.shutdown();
});
