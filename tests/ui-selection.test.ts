import test from 'node:test';
import {REASONING_LEVELS} from '../src/reasoning.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Element {
  tagName=''; id=''; type=''; checked=false; disabled=false; className=''; htmlFor=''; maxLength=0; placeholder=''; autocomplete=''; href='';
  private controlValue='';
  get value(){return this.controlValue;}
  set value(value:string){this.controlValue=this.tagName==='select'&&!this.children.some(option=>option.value===value)?'':value;}
  hidden=false;open=false;
  style={display:''}; children: Element[]=[];
  private ownText='';
  get textContent():string{return this.children.length?this.ownText+this.children.map(c=>c.textContent).join(''):this.ownText;}
  set textContent(value:string){this.ownText=value;this.children=[];}
  attributes:Record<string,string>={};
  setAttribute(name:string,value:string){this.attributes[name]=value;}
  start=1;
  onclick?:()=>Promise<void>; onchange?:()=>void; oninput?:()=>void;
  append(...children:Element[]){this.children.push(...children);}
  replaceChildren(...children:Element[]){this.children=[...children];this.ownText='';}
}
async function setup(failedHealth=false,failedPost=false,saved?:Record<string,any>,real=false,historyFetch?:(url:string)=>Promise<{ok:boolean;json:()=>Promise<any>}>,initialURL?:string,healthOverride:Record<string,unknown>={},modelFetch?:(url:string)=>Promise<{ok:boolean;json:()=>Promise<any>}>,fixtureChoices=true) {
  const elements=Object.fromEntries(['feedbackHint','feedbackStatus','prepareFeedback','followupHelp','workflowSetup','contextError','savedConfiguration','navNew','navSaved','newWorkspace','historyWorkspace','sessionResults','workspaceTitle','workspaceSubtitle','workspaceNotice','setupState','runConfigurationSummary','researchQueryField','researchError','ideaError','contextDetails','advancedSettings','participantCount','participantCountHint','saveStatus','workflowSteps','workflowProgress','authorField','acceptanceField','researchStatus','participantChoices','stageTags','workflowMode','author','acceptanceChecks','usePair','roleNote','tokenTotals','tokenDetails','jsonReport','researchMode','researchQuery','savedProvider','savedModel','savedFrom','savedTo','savedSearch','searchSaved','clearSaved','previousSaved','nextSaved','savedPage','savedSessions','openSaved','refreshSaved','savedStatus','reviewNotice','context','outcome','plannedCalls','maxCalls','providers','selectionError','run','rounds','question','feed','status','calls','cost','report','send','cancel','evidence','intervene'].map(id=>[id,new Element()]));
  elements.participantCount.tagName='select';for(const value of ['2','3'])elements.participantCount.append(Object.assign(new Element(),{value}));elements.author.tagName='select';elements.workflowMode.value='discussion';elements.rounds.value='3';elements.question.value='Synthetic question';
  const requests:Array<Record<string,any>>=[];const historyRequests:string[]=[],modelRequests:string[]=[];
  const streams:FakeEvents[]=[];
  class FakeEvents {
    onmessage?:(e:{data:string})=>void; onerror?:()=>void; closed=false;
    constructor(_url:string){streams.push(this);}close(){this.closed=true;}
  }
  const fetch=async(url:string,options?:{body?:string})=>{
    if(url==='/api/health')return {ok:!failedHealth,json:async()=>({mode:real?'real':'mock',inferenceEnabled:false,reasoningLevels:REASONING_LEVELS,agents:['codex','claude'],availableProviders:[{id:'codex',label:'OpenAI Codex',defaultModel:'codex-default'},{id:'claude',label:'Anthropic Claude',defaultModel:''},{id:'grok',label:'Grok Build',defaultModel:'grok-4.7'}],...healthOverride})};
    if(url.startsWith('/api/models?')){modelRequests.push(url);if(modelFetch)return modelFetch(url);const provider=new URLSearchParams(url.split('?')[1]).get('provider');return {ok:true,json:async()=>({provider,models:provider==='codex'?['codex-default','codex-second']:['claude-fixture','claude-second'],labels:{},total:2,truncated:false,source:'test-catalog',availabilityVerified:false,inferencePerformed:false})};}
    if(url.startsWith('/api/sessions?')&&!options){historyRequests.push(url);if(historyFetch)return historyFetch(url);return {ok:true,json:async()=>({sessions:saved?[{id:saved.id,prompt:saved.prompt,status:saved.status,createdAt:'2026-11-01'}]:[],total:saved?1:0,discoveredTotal:saved?1:0,unavailable:0,truncated:false,scanTruncated:false,page:1,pageSize:50,totalPages:1,q:'',hasPrevious:false,hasNext:false})};}
    if(url==='/api/sessions/'+(saved?.id||'saved-id')&&!options)return {ok:true,json:async()=>saved};
    requests.push({url,...JSON.parse(options?.body||'{}')});
    return {ok:!failedPost,json:async()=>failedPost?{error:'Invalid selection'}:{id:'synthetic-session'}};
  };
  const address=initialURL?new URL(initialURL):undefined;const urlWrites:string[]=[];
  const urlGlobals=address?{location:address,history:{replaceState(_state:unknown,_title:string,path:string){address.href=new URL(path,address).href;urlWrites.push(address.href);}}}:{};
  runInNewContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),{document:{getElementById:(id:string)=>elements[id],createElement:(tag:string)=>Object.assign(new Element(),{tagName:tag}),createTextNode:(text:string)=>Object.assign(new Element(),{textContent:text})},fetch,EventSource:FakeEvents,URLSearchParams,...urlGlobals});
  await new Promise(resolve=>setImmediate(resolve));
  const ui={elements,get rows(){return elements.participantChoices.children.map(card=>{const discovery=card.children.find(c=>c.className==='model-discovery')!,cloudHelp=discovery.children.find(c=>c.tagName==='details')!,reasoning=card.children.find(c=>c.className==='reasoning-control')!;return {card,effort:reasoning.children.find(c=>c.tagName==='select')!,loadReasoning:reasoning.children.find(c=>c.tagName==='button')!,effortStatus:reasoning.children.find(c=>c.tagName==='small')!,title:card.children.find(c=>c.tagName==='h3')!,role:card.children.find(c=>c.className==='participant-role')!,provider:card.children.find(c=>c.tagName==='select')!,model:card.children.find(c=>c.tagName==='input')!,discovery,picker:discovery.children.find(c=>c.tagName==='select')!,refreshModels:discovery.children.find(c=>c.tagName==='button')!,modelStatus:discovery.children.find(c=>c.tagName==='small')!,cloudHelp,cloudHint:cloudHelp.children[1],commands:cloudHelp.children[2],customButton:card.children.find(c=>c.tagName==='button')!};});},requests,streams,historyRequests,modelRequests,address,urlWrites};
  // Unrelated interaction tests explicitly enter synthetic user choices. Dedicated
  // picker tests disable this fixture action to inspect the real blank initial UI.
  if(fixtureChoices&&new Set(ui.rows.map(row=>row.provider.value)).size===ui.rows.length)for(const row of ui.rows)if(['codex','claude'].includes(row.provider.value)){await row.customButton.onclick!();row.model.value=row.provider.value==='codex'?'codex-default':'claude-fixture';row.model.oninput!();}
  return ui;
}
const ollamaHealth={agents:['ollama-local','ollama-cloud'],availableParticipants:[{id:'ollama-local',provider:'ollama-local',label:'Ollama Local',group:'ollama',requiresInstalledModel:true,defaultModel:'',modelDiscovery:true,effortMode:'model-default'},{id:'ollama-cloud',provider:'ollama-cloud',label:'Ollama Cloud',group:'ollama',requiresInstalledModel:false,defaultModel:'',modelDiscovery:true,effortMode:'model-default'}]};
const mixedHealth={agents:['codex','claude'],availableProviders:[{id:'codex',label:'OpenAI Codex',defaultModel:''},{id:'claude',label:'Anthropic Claude',defaultModel:''},{id:'ollama-local',label:'Ollama Local',defaultModel:''},{id:'ollama-cloud',label:'Ollama Cloud',defaultModel:''}],availableParticipants:[{id:'codex',provider:'codex',label:'OpenAI · Participant 1',defaultModel:''},{id:'codex-2',provider:'codex',label:'OpenAI · Participant 2',defaultModel:''},{id:'claude',provider:'claude',label:'Claude · Participant 1',defaultModel:''},{id:'claude-2',provider:'claude',label:'Claude · Participant 2',defaultModel:''},...ollamaHealth.availableParticipants,{...ollamaHealth.availableParticipants[0],id:'ollama-local-2'},{...ollamaHealth.availableParticipants[1],id:'ollama-cloud-2'}]};
const noRevision={author:'claude',reviewer:'codex',complete:true,revision:'not-needed',reason:'No material findings.',draft:{recommendation:'Pilot.'},final:null,review:{findings:[]},responses:[],changedFields:[]};
const setupGuidance={endpoint:'http://127.0.0.1:11434',catalogUrl:'https://ollama.com/search?c=cloud',docsUrl:'https://docs.ollama.com/cloud',signInCommand:"OLLAMA_HOST='http://127.0.0.1:11434' ollama signin",listCommand:"OLLAMA_HOST='http://127.0.0.1:11434' ollama ls",examples:['starter:a-cloud','starter:b-cloud'].map(model=>({model,label:model,url:'https://ollama.com/library/'+model,registerCommand:"OLLAMA_HOST='http://127.0.0.1:11434' ollama pull "+model}))};
const cloudOnlyHealth={agents:['ollama-cloud','ollama-cloud-2'],availableProviders:[mixedHealth.availableProviders[3]],availableParticipants:[ollamaHealth.availableParticipants[1],{...ollamaHealth.availableParticipants[1],id:'ollama-cloud-2'}],ollamaCloudSetup:setupGuidance};
test('model dropdowns start blank, loading never selects a model, and clearing a choice blocks defaults',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,{},undefined,false),e=ui.elements;
 assert.ok(ui.rows.every(row=>row.model.value===''&&row.picker.value===''&&row.model.hidden));assert.equal(e.run.disabled,true);assert.equal(ui.modelRequests.length,0);
 for(const row of ui.rows){await row.refreshModels.onclick!();assert.equal(row.model.value,'');assert.equal(row.picker.value,'');assert.match(row.modelStatus.textContent,/Account access is not verified/);}
 assert.equal(ui.requests.length,0);assert.equal(ui.streams.length,0);assert.equal(e.run.disabled,true);
 ui.rows[0].picker.value='codex-second';ui.rows[0].picker.onchange!();assert.equal(e.run.disabled,true);
 ui.rows[1].picker.value='claude-second';ui.rows[1].picker.onchange!();assert.equal(e.run.disabled,false);
 ui.rows[0].picker.value='';ui.rows[0].picker.onchange!();assert.equal(ui.rows[0].model.value,'');assert.equal(e.run.disabled,true);
 await e.run.onclick!();assert.equal(ui.requests.length,0);
});
test('switching provider clears the model and shares catalog choices across same-provider rows',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,mixedHealth,undefined,false);
 ui.rows[0].model.value='old-choice';ui.rows[0].model.oninput!();ui.rows[0].provider.value='claude';ui.rows[0].provider.onchange!();assert.equal(ui.rows[0].model.value,'');
 await ui.rows[0].refreshModels.onclick!();assert.ok(ui.rows.every(row=>row.picker.children.some(option=>option.value==='claude-second')));assert.ok(ui.rows.every(row=>row.model.value===''));
 ui.rows[0].picker.value='claude-fixture';ui.rows[0].picker.onchange!();ui.rows[1].picker.value='claude-second';ui.rows[1].picker.onchange!();
 await ui.elements.run.onclick!();assert.deepEqual(ui.requests[0].selection,{providers:['claude-2','claude'],models:{'claude-2':'claude-fixture',claude:'claude-second'},efforts:{'claude-2':'medium','claude':'medium'}});
});
test('failed model discovery leaves choices empty and custom model entry is an explicit user action',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,{},async()=>({ok:false,json:async()=>({error:'Catalog unavailable'})}),false);
 await ui.rows[0].refreshModels.onclick!();assert.equal(ui.rows[0].model.value,'');assert.equal(ui.rows[0].model.hidden,true);assert.match(ui.rows[0].modelStatus.textContent,/Catalog unavailable/);assert.equal(ui.requests.length,0);
 await ui.rows[0].customButton.onclick!();assert.equal(ui.rows[0].model.hidden,false);assert.equal(ui.rows[0].model.value,'');ui.rows[0].model.value='explicit-custom';ui.rows[0].model.oninput!();assert.equal(ui.rows[0].picker.value,'explicit-custom');assert.equal(ui.elements.run.disabled,true);
});
test('legacy blank-model saved sessions remain readable without catalog startup or an implicit new model',async()=>{
 const saved={id:'saved-id',prompt:'Legacy default model',status:'completed',readOnly:true,maxRounds:1,calls:2,spendKnownUSD:0,selection:{providers:['codex','claude'],models:{codex:'',claude:''}},entries:[{agent:'codex',round:1,text:'Original response'}]};
 const ui=await setup(false,false,saved,false,undefined,undefined,{},undefined,false);ui.elements.savedSessions.value='saved-id';await ui.elements.openSaved.onclick!();
 assert.match(ui.elements.feed.textContent,/Original response/);assert.ok(ui.rows.every(row=>row.model.value===''));assert.equal(ui.elements.run.disabled,true);assert.equal(ui.modelRequests.length,0);assert.equal(ui.requests.length,0);assert.equal(ui.streams.length,0);
});
test('catalog labels remain literal and partial catalog coverage stays explicit',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,{},async()=>({ok:true,json:async()=>({models:['model-a'],labels:{'model-a':'<img src=x onerror=alert(1)>'},total:null,truncated:true,omitted:1,source:'codex-cli-catalog'})}),false);
 await ui.rows[0].refreshModels.onclick!();assert.ok(ui.rows[0].picker.textContent.includes('<img src=x'));assert.match(ui.rows[0].modelStatus.textContent,/total unknown.*truncated.*unsupported/);assert.equal(ui.rows[0].model.value,'');assert.ok(!ui.rows[0].picker.children.some(option=>option.tagName==='img'));
});
test('cloud examples display per-model registration help and require registry confirmation before dispatch',async()=>{
 let registered=false,metadataCalls=0;
 const ui=await setup(false,false,undefined,false,undefined,undefined,cloudOnlyHealth,async()=>{metadataCalls++;return {ok:true,json:async()=>({models:registered?setupGuidance.examples.map(example=>example.model):[],total:registered?2:0,source:'local-ollama-registry'})};});
 assert.equal(metadataCalls,0);assert.equal(ui.rows[0].picker.children.length,3);
 for(const [i,row] of ui.rows.entries()){
  row.picker.value=setupGuidance.examples[i].model;row.picker.onchange!();assert.equal(row.model.value,setupGuidance.examples[i].model);assert.equal(row.commands.hidden,false);assert.ok(row.commands.textContent.includes(setupGuidance.examples[i].registerCommand));assert.doesNotMatch(row.commands.textContent,/ollama run|api\/chat|api\/generate/);
 }
 assert.equal(ui.elements.run.disabled,true);await ui.elements.run.onclick!();assert.equal(ui.requests.length,0);assert.equal(metadataCalls,0);
 await ui.rows[0].refreshModels.onclick!();assert.match(ui.rows[0].modelStatus.textContent,/No cloud models registered/);assert.equal(ui.elements.run.disabled,true);
 registered=true;await ui.rows[0].refreshModels.onclick!();assert.ok(ui.rows.every(row=>/registered on the configured daemon/.test(row.cloudHint.textContent)));assert.equal(ui.elements.run.disabled,false);
 await ui.elements.run.onclick!();assert.deepEqual(ui.requests[0].selection,{providers:['ollama-cloud','ollama-cloud-2'],models:{'ollama-cloud':'starter:a-cloud','ollama-cloud-2':'starter:b-cloud'}});assert.ok(ui.rows.every(row=>row.picker.disabled));
});
test('cloud setup stays visible after registry failure; local and other providers hide it',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,{...mixedHealth,ollamaCloudSetup:setupGuidance},async()=>({ok:false,json:async()=>({error:'Start Ollama and refresh.'})}));
 const row=ui.rows[0];assert.equal(row.cloudHelp.hidden,true);row.provider.value='ollama-cloud';row.provider.onchange!();assert.equal(row.cloudHelp.hidden,false);await row.refreshModels.onclick!();assert.match(row.modelStatus.textContent,/Start Ollama/);assert.equal(row.cloudHelp.hidden,false);
 row.provider.value='ollama-local';row.provider.onchange!();assert.equal(row.cloudHelp.hidden,true);assert.equal(ui.requests.length,0);
});
test('invalid daemon configuration offers browse links but no misleading registration commands',async()=>{
 const guidance={...setupGuidance,endpoint:null,signInCommand:null,listCommand:null,examples:setupGuidance.examples.map(example=>({...example,registerCommand:null}))};
 const ui=await setup(false,false,undefined,false,undefined,undefined,{...cloudOnlyHealth,ollamaCloudSetup:guidance});
 assert.equal(ui.rows[0].picker.disabled,true);assert.equal(ui.rows[0].commands.hidden,true);assert.match(ui.rows[0].cloudHint.textContent,/KOINOUS_OLLAMA_URL/);assert.ok(ui.rows[0].cloudHelp.textContent.includes('Browse all cloud models'));assert.equal(ui.requests.length,0);
});
test('workflow preview separates draft, review and conditional revision with attributed models',async()=>{
 const ui=await setup(),e=ui.elements;await e.usePair.onclick!();
 const steps=e.workflowSteps.children;assert.equal(steps.length,3);
 assert.match(steps[0].textContent,/Draft.*Anthropic Claude.*claude-sonnet-5-5.*medium effort/);
 assert.match(steps[1].textContent,/Targeted review.*OpenAI Codex.*gpt-6-astra.*medium effort/);
 assert.match(steps[2].textContent,/Revision if needed.*If needed.*claude-sonnet-5-5/);
 assert.ok(steps.every(step=>!step.className.includes('is-active')));assert.match(e.workflowProgress.textContent,/Planned flow/);
 assert.equal(e.authorField.hidden,false);assert.equal(e.acceptanceField.hidden,false);assert.equal(ui.requests.length,0);
});
test('workflow animation follows round events and skips revision only on explicit assessment',async()=>{
 const ui=await setup(),e=ui.elements;await e.usePair.onclick!();await e.run.onclick!();
 const send=(event:Record<string,unknown>)=>ui.streams[0].onmessage!({data:JSON.stringify(event)});
 send({type:'round.started',round:1,stage:'draft'});assert.match(e.workflowSteps.children[0].className,/is-active/);assert.equal(e.workflowSteps.children[0].attributes['aria-current'],'step');
 send({type:'round.completed',round:1,stage:'draft'});assert.match(e.workflowSteps.children[0].textContent,/Response received/);assert.ok(e.workflowSteps.children.every(step=>!step.className.includes('is-active')));
 send({type:'round.started',round:2,stage:'review'});assert.match(e.workflowSteps.children[1].className,/is-active/);
 send({type:'round.completed',round:2,stage:'review'});assert.doesNotMatch(e.workflowSteps.children[2].textContent,/Not needed/);
 send({type:'targeted.assessed',targeted:noRevision});send({type:'session.finished',status:'completed',spendKnownUSD:0});
 assert.match(e.workflowSteps.children[2].textContent,/Not needed/);assert.match(e.workflowSteps.children[2].className,/is-skipped/);assert.match(e.workflowProgress.textContent,/completed.*not recommendation quality/);
});
for(const status of ['failed','partial','cancelled'])test(`workflow ${status} stops animation without inventing a skipped revision`,async()=>{
 const ui=await setup(),e=ui.elements;await e.usePair.onclick!();await e.run.onclick!();
 ui.streams[0].onmessage!({data:JSON.stringify({type:'round.started',round:1,stage:'draft'})});
 if(status==='failed')ui.streams[0].onmessage!({data:JSON.stringify({type:'agent.error',round:1,agent:'claude',error:'Synthetic failure'})});
 ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status,spendKnownUSD:0})});
 assert.ok(e.workflowSteps.children.every(step=>!step.className.includes('is-active')));assert.doesNotMatch(e.workflowSteps.children[2].textContent,/Not needed/);assert.match(e.workflowProgress.textContent,new RegExp(status));
});
test('workflow connection loss removes the running animation and labels progress unknown',async()=>{
 const ui=await setup(),e=ui.elements;await e.usePair.onclick!();await e.run.onclick!();
 ui.streams[0].onmessage!({data:JSON.stringify({type:'round.started',round:2,stage:'review'})});ui.streams[0].onerror!();
 assert.ok(e.workflowSteps.children.every(step=>!step.className.includes('is-active')));assert.match(e.workflowSteps.children[1].textContent,/Status unknown/);assert.match(e.workflowProgress.textContent,/may still be running/);assert.equal(e.run.disabled,true);
});
test('saved flow restores execution without calls and missing revision evidence stays explicit',async()=>{
 const base={id:'saved-id',prompt:'Saved flow',maxRounds:3,workflowMode:'targeted',targetedConfig:{author:'claude',checks:[]},status:'completed',readOnly:true,calls:2,spendKnownUSD:0,selection:{providers:['codex','claude'],models:{codex:'astra',claude:'sonnet'}},entries:[{agent:'claude',round:1,text:'Recorded draft'},{agent:'codex',round:2,text:'Recorded review'}]};
 const legacy=await setup(false,false,base);legacy.elements.savedSessions.value='saved-id';await legacy.elements.openSaved.onclick!();
 assert.match(legacy.elements.workflowSteps.children[0].textContent,/Response received/);assert.match(legacy.elements.workflowSteps.children[2].textContent,/Not recorded/);assert.doesNotMatch(legacy.elements.workflowSteps.children[2].textContent,/Not needed/);
 const saved=await setup(false,false,{...base,targeted:noRevision});saved.elements.savedSessions.value='saved-id';await saved.elements.openSaved.onclick!();assert.match(saved.elements.workflowSteps.children[2].textContent,/Not needed/);assert.match(saved.elements.workflowProgress.textContent,/Saved run/);assert.equal(saved.requests.length,0);assert.equal(saved.streams.length,0);
 saved.rows[0].model.value='another-model';saved.rows[0].model.oninput!();assert.match(saved.elements.workflowProgress.textContent,/Planned flow/);assert.doesNotMatch(saved.elements.workflowSteps.children[2].textContent,/Not needed/);
});
test('legacy workflow respects selected rounds and hides targeted-only fields',async()=>{
 const ui=await setup(),e=ui.elements;e.rounds.value='1';e.rounds.onchange!();
 assert.equal(e.authorField.hidden,true);assert.equal(e.acceptanceField.hidden,true);assert.match(e.workflowSteps.children[0].textContent,/Independent views.*All selected participants/);
 assert.match(e.workflowSteps.children[1].textContent,/Peer critique.*Not selected/);assert.match(e.workflowSteps.children[2].textContent,/Revised positions.*Not selected/);assert.equal(e.plannedCalls.textContent,2);
});
test('fresh full-discussion pages default to two participants even when three are configured, without picking models',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,{agents:['codex','claude','grok']},undefined,false);
 assert.equal(ui.rows.length,2);assert.equal(ui.elements.participantCount.value,'2');assert.ok(ui.rows.every(row=>row.model.value===''));assert.equal(ui.elements.run.disabled,true);assert.equal(ui.modelRequests.length,0);assert.equal(ui.requests.length,0);
});
test('choosing three explicitly selects full discussion and requires configuring the extra row; count changes preserve choices',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,mixedHealth),e=ui.elements;
 e.workflowMode.value='targeted';e.workflowMode.onchange!();const first=ui.rows.map(row=>({provider:row.provider.value,model:row.model.value})),author=e.author.value;
 e.participantCount.value='3';e.participantCount.onchange!();assert.equal(ui.rows.length,3);assert.equal(e.workflowMode.value,'discussion');assert.equal(e.participantCount.value,'3');assert.equal(e.author.value,author);assert.equal(ui.rows[2].provider.value,'');assert.equal(ui.rows[2].model.value,'');assert.equal(e.run.disabled,true);assert.equal(e.plannedCalls.textContent,9);assert.match(e.runConfigurationSummary.textContent,/provider not chosen/);
 assert.deepEqual(ui.rows.slice(0,2).map(row=>({provider:row.provider.value,model:row.model.value})),first);assert.equal(ui.requests.length,0);assert.equal(ui.modelRequests.length,0);
 e.participantCount.value='2';e.participantCount.onchange!();assert.equal(ui.rows.length,2);assert.equal(e.workflowMode.value,'discussion');assert.equal(e.author.value,author);assert.deepEqual(ui.rows.map(row=>({provider:row.provider.value,model:row.model.value})),first);
 e.participantCount.value='3';e.participantCount.onchange!();const third=ui.rows[2];third.provider.value='claude';third.provider.onchange!();third.model.value='explicit-third';third.model.oninput!();assert.equal(e.plannedCalls.textContent,9);await e.run.onclick!();
 assert.deepEqual(ui.requests[0].selection,{providers:['codex','claude','claude-2'],models:{codex:'codex-default',claude:'claude-fixture','claude-2':'explicit-third'},efforts:{'codex':'medium','claude':'medium','claude-2':'medium'}});assert.equal(e.participantCount.disabled,true);e.participantCount.value='2';e.participantCount.onchange!();assert.equal(ui.rows.length,3);assert.equal(e.participantCount.value,'3');
});
test('saved three-participant sessions restore their count and models; the explicit pair preset resets the count to two',async()=>{
 const saved={id:'saved-id',prompt:'Three saved participants',status:'completed',readOnly:true,maxRounds:3,calls:3,spendKnownUSD:0,entries:[],selection:{providers:['codex','claude','grok'],models:{codex:'old-codex',claude:'old-claude',grok:'old-grok'}}};
 const ui=await setup(false,false,saved);ui.elements.savedSessions.value='saved-id';await ui.elements.openSaved.onclick!();assert.equal(ui.elements.participantCount.value,'3');assert.equal(ui.rows.length,3);assert.deepEqual(ui.rows.map(row=>row.model.value),['old-codex','old-claude','old-grok']);assert.equal(ui.requests.length,0);assert.equal(ui.streams.length,0);assert.equal(ui.modelRequests.length,0);
 await ui.elements.usePair.onclick!();assert.equal(ui.elements.participantCount.value,'2');assert.equal(ui.rows.length,2);assert.equal(ui.elements.workflowMode.value,'targeted');
});
test('the count selector respects enabled slot capacity and rejects unsupported counts',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,{agents:['codex','codex-2'],availableProviders:[mixedHealth.availableProviders[0]],availableParticipants:mixedHealth.availableParticipants.slice(0,2)},undefined,false),e=ui.elements;
 assert.equal(e.participantCount.children.find(o=>o.value==='3')!.disabled,true);e.participantCount.value='3';e.participantCount.onchange!();assert.equal(ui.rows.length,2);assert.equal(e.participantCount.value,'2');e.participantCount.value='4';e.participantCount.onchange!();assert.equal(ui.rows.length,2);assert.equal(e.participantCount.value,'2');assert.equal(ui.requests.length,0);
});
test('one participant list numbers rows globally and offers Ollama in the same provider selector',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,mixedHealth);
 assert.equal(ui.rows.length,2);
 for(const [index,row] of ui.rows.entries()){
  assert.equal(row.title.textContent,'Participant '+(index+1));assert.equal(row.provider.attributes['aria-label'],'Participant '+(index+1)+' provider');
  assert.deepEqual(row.provider.children.map(option=>option.textContent),['Choose provider','OpenAI Codex','Anthropic Claude','Ollama Local','Ollama Cloud']);
  assert.equal(row.discovery.hidden,false);
 }
 ui.rows[1].provider.value='ollama-cloud';ui.rows[1].provider.onchange!();ui.rows[1].model.value='cloud:model';ui.rows[0].model.value='astra';ui.rows[0].model.oninput!();
 assert.equal(ui.rows.length,2);assert.equal(ui.rows[1].discovery.hidden,false);
 await ui.elements.run.onclick!();assert.deepEqual(ui.requests[0].selection,{providers:['codex','ollama-cloud'],models:{codex:'astra','ollama-cloud':'cloud:model'},efforts:{'codex':'medium'}});
});
test('count changes preserve the first two identities, explicit models and draft author',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,mixedHealth),e=ui.elements;
 ui.rows[0].model.value='model-a';ui.rows[1].provider.value='codex';ui.rows[1].provider.onchange!();ui.rows[1].model.value='model-b';ui.rows[1].model.oninput!();
 assert.equal(e.author.value,'codex-2');
 e.participantCount.value='3';e.participantCount.onchange!();assert.equal(ui.rows.length,3);assert.equal(e.run.disabled,true);
 const third=ui.rows[2];assert.equal(third.provider.children.find(option=>option.value==='codex')!.disabled,true);
 third.provider.value='ollama-cloud';third.provider.onchange!();third.model.value='cloud:model';third.model.oninput!();assert.equal(e.plannedCalls.textContent,9);
 e.participantCount.value='2';e.participantCount.onchange!();e.workflowMode.value='targeted';e.workflowMode.onchange!();
 assert.equal(ui.rows.length,2);assert.equal(ui.rows[0].title.textContent,'Participant 1');assert.equal(ui.rows[1].title.textContent,'Participant 2');assert.equal(e.author.value,'codex-2');
 assert.equal(ui.rows[0].model.value,'model-a');assert.equal(ui.rows[1].model.value,'model-b');assert.match(e.author.children[1].textContent,/Participant 2 · OpenAI Codex · model-b/);
 await e.run.onclick!();assert.equal(ui.requests[0].author,'codex-2');assert.deepEqual(ui.requests[0].selection,{providers:['codex','codex-2'],models:{codex:'model-a','codex-2':'model-b'},efforts:{'codex':'medium','codex-2':'medium'}});
});
test('disabled saved providers remain reviewable but cannot be dispatched or restored by the preset',async()=>{
 const saved={id:'saved-id',prompt:'Historical',maxRounds:3,status:'completed',readOnly:true,calls:2,spendKnownUSD:0,selection:{providers:['claude','claude-2'],models:{claude:'old-a','claude-2':'old-b'}},entries:[]};
 const health={agents:['codex','codex-2'],availableProviders:[mixedHealth.availableProviders[0]],availableParticipants:mixedHealth.availableParticipants.slice(0,2)};
 const ui=await setup(false,false,saved,false,undefined,undefined,health);ui.elements.savedSessions.value='saved-id';await ui.elements.openSaved.onclick!();
 assert.equal(ui.rows[0].model.value,'old-a');assert.match(ui.rows[0].provider.textContent,/Unavailable on this server: claude/);
 assert.equal(ui.elements.run.disabled,true);assert.equal(ui.elements.usePair.disabled,true);await ui.elements.usePair.onclick!();await ui.elements.run.onclick!();assert.equal(ui.requests.length,0);
 assert.ok(ui.rows.every(row=>!row.provider.children.some(option=>option.value==='claude')));
});
test('late Ollama metadata cannot overwrite a participant switched to another provider',async()=>{
 let complete!:(value:{ok:boolean;json:()=>Promise<any>})=>void;
 const ui=await setup(false,false,undefined,false,undefined,undefined,mixedHealth,async()=>new Promise(resolve=>{complete=resolve;}));
 const row=ui.rows[0];row.provider.value='ollama-local';row.provider.onchange!();const pending=row.refreshModels.onclick!();
 row.provider.value='codex';row.provider.onchange!();row.model.value='kept-model';row.model.oninput!();
 complete({ok:true,json:async()=>({models:['local:model'],total:1,source:'local-ollama-registry'})});await pending;
 assert.equal(row.provider.value,'codex');assert.equal(row.model.value,'kept-model');assert.equal(row.discovery.hidden,false);assert.equal(row.modelStatus.textContent,'No model list requested.');assert.equal(ui.requests.length,0);
});
test('saved author is selected after its new participant options exist in the DOM',async()=>{
 const saved={id:'saved-id',prompt:'Saved author',maxRounds:3,status:'completed',readOnly:true,calls:2,spendKnownUSD:0,workflowMode:'targeted',targetedConfig:{author:'codex-2',checks:[]},selection:{providers:['codex-2','claude'],models:{'codex-2':'saved-author',claude:'saved-reviewer'}},entries:[]};
 const ui=await setup(false,false,saved,false,undefined,undefined,mixedHealth);assert.equal(ui.elements.author.value,'claude');
 ui.elements.savedSessions.value='saved-id';await ui.elements.openSaved.onclick!();
 assert.equal(ui.elements.author.value,'codex-2');assert.match(ui.elements.author.children[0].textContent,/Participant 1 · OpenAI Codex · saved-author/);assert.equal(ui.requests.length,0);
});
test('one local refresh validates both same-provider rows and rejects an unlisted model',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,mixedHealth,async()=>({ok:true,json:async()=>({models:['local:a','local:b'],total:2,source:'local-ollama-registry'})}));
 for(const row of ui.rows){row.provider.value='ollama-local';row.provider.onchange!();}
 await ui.rows[0].refreshModels.onclick!();
 for(const [i,row] of ui.rows.entries()){assert.match(row.modelStatus.textContent,/2 of 2 registered/);row.model.value=i?'local:b':'local:a';row.model.oninput!();}
 assert.equal(ui.elements.run.disabled,false);ui.rows[1].model.value='unlisted';ui.rows[1].model.oninput!();assert.equal(ui.elements.run.disabled,true);
 ui.rows[1].model.value='local:b';ui.rows[1].model.oninput!();await ui.elements.run.onclick!();assert.deepEqual(ui.requests[0].selection.providers,['ollama-local','ollama-local-2']);
});
test('Ollama UI explicitly refreshes metadata, selects models and records default effort',async()=>{
 const metadataRequests:string[]=[];
 const f=await setup(false,false,undefined,false,undefined,undefined,ollamaHealth,async url=>{metadataRequests.push(url);return {ok:true,json:async()=>({models:['registered-model'],total:1,source:'mock',truncated:false,unsupported:0})};});
 assert.equal(metadataRequests.length,0);assert.equal(f.elements.run.disabled,true);
 for(const row of f.rows){await row.refreshModels.onclick!();row.picker.value='registered-model';row.picker.onchange!();assert.match(row.modelStatus.textContent,/1 of 1 registered models/);}
 assert.deepEqual(metadataRequests,['/api/models?provider=ollama-local','/api/models?provider=ollama-cloud']);
 f.elements.workflowMode.value='targeted';f.elements.workflowMode.onchange!();assert.match(f.elements.workflowSteps.textContent,/model default effort/);assert.doesNotMatch(f.elements.workflowSteps.textContent,/low effort|medium effort/);assert.equal(f.elements.run.disabled,false);
 await f.elements.run.onclick!();assert.equal(f.requests.length,1);assert.deepEqual(f.requests[0].selection,{providers:['ollama-local','ollama-cloud'],models:{'ollama-local':'registered-model','ollama-cloud':'registered-model'}});
 assert.ok(f.rows.every(row=>row.picker.disabled&&row.refreshModels.disabled&&row.provider.disabled));
});
test('Ollama UI reports metadata errors while inference stays disabled',async()=>{
 const f=await setup(false,false,undefined,true,undefined,undefined,ollamaHealth,async()=>({ok:false,json:async()=>({error:'Start Ollama and refresh.'})}));
 await f.rows[0].refreshModels.onclick!();assert.equal(f.rows[0].modelStatus.textContent,'Start Ollama and refresh.');assert.equal(f.elements.run.disabled,true);assert.equal(f.requests.length,0);
});
for(const mode of ['wikipedia','web','both'])test(`research ${mode} is sent only after explicit selection with its public query`,async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,{research:{web:true}});
 ui.elements.researchMode.value=mode;ui.elements.researchMode.onchange!();ui.elements.researchQuery.value='public topic only';ui.elements.context.value='private context';await ui.elements.run.onclick!();
 assert.deepEqual(ui.requests[0].research,{mode,query:'public topic only'});assert.equal(ui.elements.researchMode.disabled,true);
});
test('research is absent by default; unconfigured web is refused and Wikipedia stays available',async()=>{
 const plain=await setup();await plain.elements.run.onclick!();assert.equal(Object.hasOwn(plain.requests[0],'research'),false);
 const ui=await setup();ui.elements.researchMode.value='both';ui.elements.researchMode.onchange!();assert.equal(ui.elements.run.disabled,true);assert.match(ui.elements.researchStatus.textContent,/not configured/);await ui.elements.run.onclick!();assert.equal(ui.requests.length,0);
 ui.elements.researchMode.value='wikipedia';ui.elements.researchMode.onchange!();ui.elements.researchQuery.value='public';ui.elements.researchQuery.oninput!();assert.equal(ui.elements.run.disabled,false);
});
test('research coverage labels mixed sources and personal/enterprise login without inferring workspace verification',async()=>{
 const real=await setup(false,false,undefined,true);assert.match(real.elements.providers.textContent,/personal or enterprise account login/);
 const ui=await setup(false,false,undefined,false,undefined,undefined,{research:{web:true}});await ui.elements.run.onclick!();
 ui.streams[0].onmessage!({data:JSON.stringify({type:'research.completed',mode:'both',providers:['Wikipedia','Brave Search'],scope:'Article introductions and search snippets; full pages not fetched.',coverage:[{source:'web',returned:2,received:4,resultsOmitted:2}],sources:[{id:'web-1',uri:'https://example.org',text:'snippet'}]})});
 assert.match(ui.elements.evidence.textContent,/Wikipedia \+ Brave Search/);assert.match(ui.elements.feed.textContent,/2 of 4 returned candidates/);assert.match(ui.elements.feed.textContent,/full pages not fetched/);
});
test('saved both-source research selection reopens without research or model requests',async()=>{
 const saved={id:'saved-id',prompt:'Saved task',status:'completed',readOnly:true,maxRounds:1,calls:2,spendKnownUSD:0,spendIncomplete:true,research:{mode:'both',query:'saved public query'},selection:{providers:['codex','claude'],models:{}},entries:[]};
 const ui=await setup(false,false,saved,true);ui.elements.savedSessions.value='saved-id';await ui.elements.openSaved.onclick!();assert.equal(ui.elements.researchMode.value,'both');assert.equal(ui.elements.researchQuery.value,'saved public query');assert.equal(ui.requests.length,0);assert.equal(ui.elements.run.disabled,true);
});
test('Ollama uses the same participant rows and blocks dispatch until installed models are found',async()=>{
 let calls=0;
 const f=await setup(false,false,undefined,false,undefined,undefined,ollamaHealth,async()=>{calls++;return {ok:true,json:async()=>({models:[],total:0,source:'local-ollama-registry',truncated:false,unsupported:0})};});
 assert.equal(f.rows.length,2);assert.equal(f.rows[0].title.textContent,'Participant 1');assert.equal(f.rows[1].title.textContent,'Participant 2');
 assert.equal(f.rows[0].provider.value,'ollama-local');assert.equal(f.rows[1].provider.value,'ollama-cloud');assert.equal(calls,0);
 await f.rows[0].refreshModels.onclick!();
 assert.equal(calls,1);assert.equal(f.elements.run.disabled,true);assert.match(f.rows[0].modelStatus.textContent,/No local models installed/);assert.equal(f.requests.length,0);
});
test('installed-model refresh unlocks both local slots and refuses invented local IDs',async()=>{
 const health={...ollamaHealth,availableParticipants:[...ollamaHealth.availableParticipants,{...ollamaHealth.availableParticipants[0],id:'ollama-local-2',label:'Ollama Local 2'}]};
 const f=await setup(false,false,undefined,false,undefined,undefined,health,async()=>({ok:true,json:async()=>({models:['installed:small'],total:1,source:'local-ollama-registry',truncated:false,unsupported:0})}));
 await f.rows[0].refreshModels.onclick!();
 f.rows[0].model.value='invented:model';f.rows[1].model.value='cloud-alias';f.rows[0].model.oninput!();
 assert.equal(f.elements.run.disabled,true);assert.match(f.elements.selectionError.textContent,/model available on this machine/);
 f.rows[0].model.value='installed:small';f.rows[0].model.oninput!();assert.equal(f.elements.run.disabled,false);assert.equal(f.requests.length,0);
});
test('a removed local model or unavailable daemon blocks dispatch and can recover without losing the choice',async()=>{
 let state='installed';
 const f=await setup(false,false,undefined,false,undefined,undefined,ollamaHealth,async()=>state==='error'?{ok:false,json:async()=>({error:'Ollama is unavailable.'})}:{ok:true,json:async()=>({models:state==='installed'?['installed:small']:[],total:state==='installed'?1:0,source:'local-ollama-registry',truncated:false,unsupported:0})});
 const row=f.rows[0];
 await row.refreshModels.onclick!();row.model.value='installed:small';f.rows[1].model.value='cloud-alias';row.model.oninput!();assert.equal(f.elements.run.disabled,false);
 state='empty';await row.refreshModels.onclick!();assert.equal(f.elements.run.disabled,true);assert.equal(row.model.value,'installed:small');
 state='installed';await row.refreshModels.onclick!();assert.equal(f.elements.run.disabled,false);
 state='error';await row.refreshModels.onclick!();assert.equal(f.elements.run.disabled,true);assert.equal(row.model.value,'installed:small');assert.equal(row.provider.disabled,false);assert.equal(f.requests.length,0);
});
test('saved Ollama selection and accounting reopen without model discovery or inference',async()=>{
 const saved={id:'saved-id',prompt:'Old task',status:'completed',readOnly:true,maxRounds:3,calls:2,spendKnownUSD:0,spendIncomplete:true,workflowMode:'targeted',targetedConfig:{author:'ollama-local',checks:[]},selection:{providers:['ollama-local','ollama-cloud'],models:{'ollama-local':'saved-local','ollama-cloud':'saved-cloud'}},entries:[],tokenAccounting:{knownTotalTokens:120,missingCalls:0,calls:[]}};
 const f=await setup(false,false,saved,true,undefined,undefined,ollamaHealth,async()=>{throw Error('Saved view must not discover models');});
 await f.elements.openSaved.onclick!(); // No selected history ID yet.
 f.elements.savedSessions.value='saved-id';await f.elements.openSaved.onclick!();
 assert.equal(f.rows[0].model.value,'saved-local');assert.equal(f.rows[1].model.value,'saved-cloud');assert.match(f.elements.tokenTotals.textContent,/120/);assert.equal(f.requests.length,0);assert.match(f.elements.workflowSteps.textContent,/model default effort/);
});
test('UI hydrates only participating rows and requires a provider and valid model for every row',async()=>{
 const {elements,rows,requests}=await setup();
 assert.equal(rows.length,2);assert.equal(rows[0].model.placeholder,'Enter an explicit model ID');assert.equal(rows[0].title.textContent,'Participant 1');assert.equal(rows[1].title.textContent,'Participant 2');
 assert.equal(elements.run.disabled,false);assert.equal(elements.maxCalls.textContent,6);
 rows[1].provider.value='';rows[1].provider.onchange!();assert.equal(elements.run.disabled,true);assert.match(elements.selectionError.textContent,/available provider/);
 await elements.run.onclick!();assert.equal(requests.length,0);
 rows[1].provider.value='grok';rows[1].provider.onchange!();rows[1].model.value='grok-4.7';rows[1].model.oninput!();assert.equal(elements.run.disabled,false);assert.equal(rows[1].model.disabled,false);
 rows[1].model.value='--bad';rows[1].model.oninput!();assert.equal(elements.run.disabled,true);assert.equal(rows[1].model.attributes['aria-invalid'],'true');assert.match(rows[1].card.textContent,/Enter a valid model ID/);
});
test('UI sends only selected models, freezes running controls, handles completion and preserves user choices',async()=>{
 const ui=await setup();const {elements,rows,requests,streams}=ui;rows[0].model.value=' chosen-model ';
 await elements.run.onclick!();
 assert.deepEqual(requests[0].selection,{providers:['codex','claude'],models:{codex:'chosen-model',claude:'claude-fixture'},efforts:{'codex':'medium','claude':'medium'}});
 assert.equal(elements.run.disabled,true);assert.ok(rows.every(row=>row.provider.disabled&&row.model.disabled));assert.equal(elements.participantCount.disabled,true);assert.equal(elements.navSaved.disabled,true);
 await elements.run.onclick!();assert.equal(requests.length,1);
 streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'completed',spendKnownUSD:0.01,spendIncomplete:true})});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(elements.run.disabled,false);assert.match(elements.cost.textContent,/unknown costs/);assert.equal(streams[0].closed,true);
 elements.participantCount.value='3';elements.participantCount.onchange!();ui.rows[2].provider.value='grok';ui.rows[2].provider.onchange!();assert.equal(elements.plannedCalls.textContent,9);assert.equal(elements.maxCalls.textContent,6);
 assert.equal(rows[0].model.value,' chosen-model ');assert.equal(elements.report.style.display,'inline');
});
test('completion automatically lists and selects the saved session and reopens its data without another run',async()=>{
 const saved={id:'synthetic-session',prompt:'Synthetic question',context:'Recorded context',status:'completed',readOnly:true,maxRounds:1,calls:2,spendKnownUSD:0,spendIncomplete:true,entries:[{agent:'codex',round:1,text:'Preserved original recommendation'}],tokenAccounting:{knownTotalTokens:42,missingCalls:0,calls:[]}};
 const ui=await setup(false,false,saved),e=ui.elements;const before=ui.historyRequests.length;
 await e.run.onclick!();ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'completed',tokenAccounting:saved.tokenAccounting})});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.historyRequests.length,before+1);assert.equal(e.savedSessions.value,saved.id);assert.match(e.saveStatus.textContent,/completed.*saved automatically/);assert.equal(e.openSaved.disabled,false);assert.equal(ui.requests.length,1);assert.equal(ui.modelRequests.length,0);
 assert.equal(e.savedSessions.children.filter(c=>c.value===saved.id).length,1);assert.doesNotMatch(e.savedStatus.textContent,/outside these results/);
 await e.openSaved.onclick!();assert.match(e.feed.textContent,/Preserved original recommendation/);assert.match(e.tokenTotals.textContent,/42/);assert.match(e.saveStatus.textContent,/read-only/);assert.equal(ui.historyRequests.length,before+1);assert.equal(ui.requests.length,1);assert.equal(ui.streams.length,1);
 ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'failed'})});assert.equal(e.status.textContent,'completed');assert.match(e.saveStatus.textContent,/read-only/);assert.equal(ui.historyRequests.length,before+1);
});
test('completion preserves history filters/page and labels its extra option outside matching counts',async()=>{
 const ui=await setup(false,false,undefined,false,async url=>{const p=new URL(url,'http://local').searchParams;return {ok:true,json:async()=>({sessions:[],page:Number(p.get('page')),q:p.get('q'),filters:Object.fromEntries(['provider','model','from','to'].map(k=>[k,p.get(k)||''])),pageSize:50,total:60,discoveredTotal:60,totalPages:2,hasPrevious:true,hasNext:false,unavailable:0})};},'http://local/?view=new&page=2&q=older&provider=claude&model=old-model');
 await ui.elements.run.onclick!();ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'completed'})});await new Promise(resolve=>setImmediate(resolve));
 const p=new URL(ui.historyRequests.at(-1)!,'http://local').searchParams;assert.equal(p.get('page'),'2');assert.equal(p.get('q'),'older');assert.equal(p.get('model'),'old-model');assert.equal(ui.elements.savedModel.value,'old-model');assert.equal(ui.elements.savedSessions.value,'synthetic-session');assert.match(ui.elements.savedSessions.textContent,/Just finished.*completed/);assert.match(ui.elements.savedStatus.textContent,/of 60 matching.*outside these results.*not included/);assert.equal(ui.address!.searchParams.get('session'),'synthetic-session');
});
test('automatic-list failure retains downloads and Refresh list retries selection and confirmation',async()=>{
 let fail=false;const ui=await setup(false,false,undefined,false,async()=>({ok:!fail,json:async()=>fail?{error:'History unavailable'}:{sessions:[],q:'',page:1,pageSize:50,total:0,discoveredTotal:0,totalPages:1,unavailable:0}})),e=ui.elements;
 await e.run.onclick!();fail=true;ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'completed'})});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(e.status.textContent,'completed');assert.match(e.saveStatus.textContent,/list could not refresh.*Refresh list/);assert.equal(e.report.style.display,'inline');assert.equal(e.jsonReport.style.display,'inline');assert.equal(e.openSaved.disabled,true);
 fail=false;await e.refreshSaved.onclick!();assert.equal(e.savedSessions.value,'synthetic-session');assert.equal(e.openSaved.disabled,false);assert.match(e.saveStatus.textContent,/Selected in Saved discussions/);assert.equal(ui.requests.length,1);
});
for(const status of ['partial','failed','cancelled'])test(`${status} completion is saved and listed with its original status`,async()=>{
 const ui=await setup();await ui.elements.run.onclick!();ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status})});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.elements.status.textContent,status);assert.match(ui.elements.saveStatus.textContent,new RegExp('Session '+status+' · saved automatically'));assert.doesNotMatch(ui.elements.saveStatus.textContent,/Session completed/);assert.equal(ui.elements.savedSessions.value,'synthetic-session');
});
test('pending history refresh blocks a new run and late events cannot overwrite another saved review',async()=>{
 let hold=false,release!:()=>void;const saved={id:'saved-id',prompt:'Older record',status:'completed',readOnly:true,maxRounds:1,calls:0,spendKnownUSD:0,entries:[]};
 const ui=await setup(false,false,saved,false,async()=>{if(hold)await new Promise<void>(r=>{release=r;});return {ok:true,json:async()=>({sessions:[{...saved,createdAt:'2026-11-01'}],q:'',page:1,pageSize:50,total:1,discoveredTotal:1,totalPages:1,unavailable:0})};});
 await ui.elements.run.onclick!();hold=true;ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'completed'})});assert.equal(ui.elements.run.disabled,true);await ui.elements.run.onclick!();assert.equal(ui.requests.length,1);release();await new Promise(resolve=>setImmediate(resolve));
 ui.elements.savedSessions.value='saved-id';await ui.elements.openSaved.onclick!();const count=ui.historyRequests.length;ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'failed'})});ui.streams[0].onerror!();assert.equal(ui.elements.status.textContent,'completed');assert.match(ui.elements.saveStatus.textContent,/read-only/);assert.equal(ui.historyRequests.length,count);
});
test('UI fails closed on configuration failure and recovers controls after rejected request',async()=>{
 const failed=await setup(true);assert.equal(failed.elements.run.disabled,true);await failed.elements.run.onclick!();assert.equal(failed.requests.length,0);
 const rejected=await setup(false,true);await rejected.elements.run.onclick!();assert.equal(rejected.elements.run.disabled,false);assert.equal(rejected.streams.length,0);assert.equal(rejected.elements.sessionResults.hidden,false);assert.match(rejected.elements.feed.textContent,/Invalid selection/);await rejected.elements.navNew.onclick!();assert.equal(rejected.elements.sessionResults.hidden,true);
});

test('UI shows runtime preparation and cleanup, retaining locked controls until finalization',async()=>{
 const {elements,streams}=await setup();await elements.run.onclick!();
 const send=(type:string)=>streams[0].onmessage!({data:JSON.stringify({type,agent:'grok'})});
 send('runtime.preparing');assert.equal(elements.status.textContent,'Preparing runtime');assert.equal(elements.run.disabled,true);
 send('runtime.ready');send('runtime.cleaning');assert.equal(elements.status.textContent,'Cleaning up');assert.equal(elements.report.style.display,'none');
 send('runtime.cleaned');assert.equal(elements.run.disabled,true);assert.equal(streams[0].closed,false);
});

test('UI sends optional context with grounding off and displays the assessed recommendation safely',async()=>{
 const {elements,requests,streams}=await setup();elements.context.value='Keep support coverage';await elements.run.onclick!();
 assert.equal(requests[0].context,'Keep support coverage');assert.equal(requests[0].grounding,'none');
 streams[0].onmessage!({data:JSON.stringify({type:'discussion.assessed',outcome:{recommendation:'<b>Run a pilot</b>',status:'majority-direction',coverage:{valid:3,expected:3},proposalBy:'codex',supporters:['codex','claude'],positions:[{agent:'codex',position:{rationale:'Test demand',risks:['Cost']}}],nextSteps:['Measure results'],unresolved:[{agent:'grok',text:'Budget uncertain'}],caveat:'Not verified consensus'}})});
 assert.match(elements.outcome.textContent,/Run a pilot/);assert.match(elements.outcome.textContent,/grok: Budget uncertain/);assert.match(elements.outcome.textContent,/Test demand/);assert.match(elements.outcome.textContent,/Measure results/);assert.equal(elements.run.disabled,true);
});

test('UI opens saved sessions with exact responses and outcome using GET only, without an EventSource or new discussion',async()=>{
 const saved={id:'saved-id',prompt:'Saved <idea>',context:'Original context',maxRounds:3,status:'completed',readOnly:true,calls:9,maxCalls:9,spendKnownUSD:0.1,spendIncomplete:true,evidence:null,selection:{providers:['codex','claude','grok'],models:{codex:'saved-codex',claude:'saved-claude',grok:'saved-grok'}},entries:[1,2,3].flatMap(round=>['codex','claude','grok'].map(agent=>({round,agent,text:`<b>${agent} ${round}</b>`}))),outcome:{recommendation:'Run a pilot',status:'direction-alignment',coverage:{valid:3,expected:3},proposalBy:'codex',supporters:['codex','claude','grok'],positions:[],nextSteps:['Measure'],unresolved:[{agent:'grok',text:'Timing disputed'}],caveat:'Not correctness'}};
 const ui=await setup(false,false,saved,true);const {elements,requests,streams}=ui;
 elements.savedSessions.value='saved-id';elements.savedSessions.onchange!();await elements.openSaved.onclick!();
 assert.equal(elements.run.disabled,true);await elements.run.onclick!();
 assert.equal(requests.length,0);assert.equal(streams.length,0);assert.equal(elements.status.textContent,'completed');assert.equal(elements.calls.textContent,9);assert.equal(elements.maxCalls.textContent,9);
 assert.equal(elements.feed.children.filter(e=>['codex','claude','grok'].some(id=>e.className==='message '+id)).length,9);
 assert.match(elements.outcome.textContent,/Aligned direction · proposals differ/);assert.match(elements.outcome.textContent,/Timing disputed/);assert.equal(ui.rows[0].model.value,'saved-codex');assert.equal(elements.question.value,saved.prompt);
 assert.equal(elements.send.disabled,true);assert.equal(elements.cancel.disabled,true);assert.match(elements.reviewNotice.textContent,/read-only/);assert.match(elements.cost.textContent,/unknown costs/);
 assert.equal(elements.report.href,'/api/sessions/saved-id/report');
});
test('UI explains absent legacy assessments without inventing agreement',async()=>{
 const {elements}=await setup(false,false,{id:'saved-id',prompt:'Legacy',maxRounds:1,status:'partial',readOnly:true,calls:1,maxCalls:2,spendKnownUSD:0,spendIncomplete:true,entries:[],outcome:null});
 elements.savedSessions.value='saved-id';await elements.openSaved.onclick!();assert.match(elements.outcome.textContent,/No agreement assessment was recorded/);assert.equal(elements.status.textContent,'partial');
});

test('history UI navigates pages, resets on search, preserves applied search on refresh and clears it',async()=>{
 const {elements,historyRequests,requests,streams}=await setup(false,false,undefined,true,async url=>{
  const p=new URL(url,'http://local').searchParams,q=p.get('q')||'',page=q?1:Number(p.get('page'));
  return {ok:true,json:async()=>({sessions:q?[]:[{id:'page-'+page,prompt:'Saved',status:'completed',createdAt:'2026-11-01'}],q,page,pageSize:50,total:q?0:51,discoveredTotal:51,totalPages:q?1:2,hasNext:!q&&page===1,hasPrevious:!q&&page===2,scanTruncated:true,unavailable:2})};
 });
 assert.equal(elements.previousSaved.disabled,true);assert.equal(elements.nextSaved.disabled,false);
 await elements.nextSaved.onclick!();assert.match(historyRequests.at(-1)!,/page=2/);assert.equal(elements.nextSaved.disabled,true);assert.equal(elements.previousSaved.disabled,false);
 await elements.previousSaved.onclick!();assert.match(historyRequests.at(-1)!,/page=1/);
 elements.savedSearch.value='older & question';await elements.searchSaved.onclick!();assert.match(historyRequests.at(-1)!,/page=1&pageSize=50&q=older%20%26%20question/);assert.match(elements.savedStatus.textContent,/0–0 of 0/);assert.match(elements.savedStatus.textContent,/Discovery is partial/);assert.equal(elements.nextSaved.disabled,true);
 elements.savedSearch.value='unapplied';await elements.refreshSaved.onclick!();assert.match(historyRequests.at(-1)!,/older%20%26%20question/);
 await elements.clearSaved.onclick!();assert.equal(elements.savedSearch.value,'');assert.equal(elements.nextSaved.disabled,false);assert.equal(elements.run.disabled,true);assert.equal(requests.length,0);assert.equal(streams.length,0);
});
test('history fetch failure clears stale choices and paging; overlapping requests are prevented and retry works',async()=>{
 let fail=false,hold=false,release!:()=>void;
 const {elements,historyRequests}=await setup(false,false,undefined,true,async()=>{
  if(hold)await new Promise<void>(r=>{release=r;});
  return {ok:!fail,json:async()=>({sessions:[{id:'saved-id',prompt:'Saved',status:'completed',createdAt:'2026-11-01'}],q:'',page:1,pageSize:50,total:51,discoveredTotal:51,totalPages:2,hasNext:true,hasPrevious:false,scanTruncated:false,unavailable:0})};
 });
 hold=true;const pending=elements.nextSaved.onclick!();assert.equal(elements.nextSaved.disabled,true);assert.equal(elements.searchSaved.disabled,true);await elements.nextSaved.onclick!();assert.equal(historyRequests.length,2);fail=true;release();await pending;
 assert.equal(elements.openSaved.disabled,true);assert.equal(elements.nextSaved.disabled,true);assert.match(elements.savedStatus.textContent,/unavailable/);
 hold=false;fail=false;await elements.refreshSaved.onclick!();assert.equal(elements.nextSaved.disabled,false);
});

test('combined history filters reset page, persist applied values on paging/refresh and clear together without inference',async()=>{
 const {elements,historyRequests,requests,streams}=await setup(false,false,undefined,true,async url=>{
  const p=new URL(url,'http://local').searchParams;
  return {ok:true,json:async()=>({sessions:[],q:p.get('q')||'',filters:Object.fromEntries(['provider','model','from','to'].map(k=>[k,p.get(k)||''])),page:Number(p.get('page')),pageSize:50,total:51,discoveredTotal:100,totalPages:2,hasPrevious:p.get('page')==='2',hasNext:p.get('page')==='1',scanTruncated:false,unavailable:0})};
 });
 elements.savedProvider.value='codex';elements.savedModel.value='gpt-6-astra';elements.savedFrom.value='2026-11-01';elements.savedTo.value='2026-11-02';await elements.searchSaved.onclick!();
 let p=new URL(historyRequests.at(-1)!,'http://local').searchParams;assert.equal(p.get('provider'),'codex');assert.equal(p.get('model'),'gpt-6-astra');assert.equal(p.get('from'),'2026-11-01');assert.equal(p.get('to'),'2026-11-02');assert.equal(p.get('page'),'1');
 elements.savedModel.value='unapplied';await elements.nextSaved.onclick!();p=new URL(historyRequests.at(-1)!,'http://local').searchParams;assert.equal(p.get('page'),'2');assert.equal(p.get('model'),'gpt-6-astra');
 await elements.refreshSaved.onclick!();assert.equal(elements.savedModel.value,'gpt-6-astra');
 await elements.clearSaved.onclick!();assert.ok(['savedProvider','savedModel','savedFrom','savedTo'].every(k=>elements[k].value===''));assert.equal(requests.length,0);assert.equal(streams.length,0);assert.equal(elements.run.disabled,true);
});

const bookmarkResponse=async(url:string)=>{
 const params=new URL(url,'http://local').searchParams;
 return {ok:true,json:async()=>({sessions:[{id:'saved-id',prompt:'Saved idea',status:'completed',createdAt:'2026-11-01'}],q:(params.get('q')||'').trim(),filters:Object.fromEntries(['provider','model','from','to'].map(k=>[k,params.get(k)||''])),page:Math.min(Number(params.get('page')),3),pageSize:50,total:120,discoveredTotal:120,totalPages:3,hasPrevious:Number(params.get('page'))>1,hasNext:Number(params.get('page'))<3,scanTruncated:false,unavailable:0})};
};
const bookmarkedSession={id:'saved-id',prompt:'Saved idea',context:'Context',maxRounds:1,status:'completed',readOnly:true,calls:2,maxCalls:2,spendKnownUSD:0,spendIncomplete:true,entries:[],outcome:null};
test('URL bookmark restores search, every filter, page and session without POST or EventSource',async()=>{
 const url='http://local/?q=caf%C3%A9+%26+A%2BB&page=2&provider=codex&model=gpt-test&from=2026-11-01&to=2026-11-02&session=saved-id&extra=keep#report';
 const restored=await setup(false,false,bookmarkedSession,true,bookmarkResponse,url);
 assert.equal(restored.elements.savedSearch.value,'café & A+B');assert.equal(restored.elements.savedProvider.value,'codex');assert.equal(restored.elements.savedModel.value,'gpt-test');assert.equal(restored.elements.savedFrom.value,'2026-11-01');assert.equal(restored.elements.savedTo.value,'2026-11-02');assert.equal(restored.elements.savedPage.textContent,'Page 2 of 3');assert.equal(restored.elements.status.textContent,'completed');
 const params=restored.address!.searchParams;assert.equal(params.get('session'),'saved-id');assert.equal(params.get('page'),'2');assert.equal(params.get('q'),'café & A+B');assert.equal(params.get('extra'),'keep');assert.equal(restored.address!.hash,'#report');assert.equal(restored.requests.length,0);assert.equal(restored.streams.length,0);assert.equal(restored.elements.run.disabled,true);
 const reloaded=await setup(false,false,bookmarkedSession,true,bookmarkResponse,restored.address!.href);assert.equal(reloaded.address!.href,restored.address!.href);assert.equal(reloaded.elements.savedPage.textContent,'Page 2 of 3');assert.equal(reloaded.elements.status.textContent,'completed');
});
test('applied search/paging/session changes update URL; drafts do not; clear resets filters but preserves opened session',async()=>{
 const ui=await setup(false,false,bookmarkedSession,true,bookmarkResponse,'http://local/?page=2&q=old&provider=codex&model=gpt-test');
 ui.elements.savedSearch.value='new & <idea>';ui.elements.savedFrom.value='2026-11-01';assert.equal(ui.address!.searchParams.get('q'),'old');await ui.elements.searchSaved.onclick!();
 assert.equal(ui.address!.searchParams.get('q'),'new & <idea>');assert.equal(ui.address!.searchParams.get('page'),'1');assert.equal(ui.address!.searchParams.get('from'),'2026-11-01');
 await ui.elements.nextSaved.onclick!();assert.equal(ui.address!.searchParams.get('page'),'2');ui.elements.savedSessions.value='saved-id';await ui.elements.openSaved.onclick!();assert.equal(ui.address!.searchParams.get('session'),'saved-id');assert.equal(ui.address!.searchParams.get('q'),'new & <idea>');assert.equal(ui.address!.searchParams.get('page'),'2');
 await ui.elements.clearSaved.onclick!();for(const key of ['q','provider','model','from','to'])assert.equal(ui.address!.searchParams.has(key),false);assert.equal(ui.address!.searchParams.get('page'),'1');assert.equal(ui.address!.searchParams.get('session'),'saved-id');assert.equal(ui.requests.length,0);
});
test('server page correction is bookmarked; failed or invalid restores leave the original URL intact and make no model request',async()=>{
 const corrected=await setup(false,false,undefined,true,bookmarkResponse,'http://local/?page=999');assert.equal(corrected.address!.searchParams.get('page'),'3');
 const invalid='http://local/?page=2%26provider%3Dgrok&from=invalid&session=saved-id';
 const failed=await setup(false,false,bookmarkedSession,true,async()=>({ok:false,json:async()=>({error:'Invalid date'})}),invalid);
 assert.equal(failed.address!.href,invalid);assert.equal(failed.urlWrites.length,0);assert.match(failed.elements.savedStatus.textContent,/Invalid date/);assert.equal(failed.elements.status.textContent,'');assert.equal(failed.requests.length,0);assert.equal(failed.streams.length,0);
 assert.match(failed.historyRequests[0],/page=2%26provider%3Dgrok/);
});
test('session-only legacy bookmarks still restore while retaining default list state',async()=>{
 const ui=await setup(false,false,bookmarkedSession,true,bookmarkResponse,'http://local/?session=saved-id');assert.equal(ui.elements.status.textContent,'completed');assert.equal(ui.address!.searchParams.get('session'),'saved-id');assert.equal(ui.address!.searchParams.get('page'),'1');
});

test('saved UI shows unsupported claims and coverage without providers or inference',async()=>{
 const {assessDiscussion}=await import('../src/discussion-outcome.ts');
 const {makeReport}=await import('../src/core.ts');
 const position={direction:'pilot',recommendation:'Try a pilot',rationale:'Test assumptions',risks:[],disagreements:['Duration unresolved'],nextSteps:['Define metrics'],claims:[{id:'c1',kind:'fact',text:'<b>Guaranteed improvement</b>',evidenceIds:[],snapshotId:null}]};
 const s={id:'saved-id',prompt:'Idea',status:'completed',maxRounds:3,participants:['codex','claude'],entries:['codex','claude'].map(agent=>({agent,round:3,text:JSON.stringify(position)})),events:[],interventions:[],calls:6,spendKnownUSD:0,spendIncomplete:true,cancel:new AbortController()} as import('../src/core.ts').Session;
 const outcome=assessDiscussion(s);assert.match(makeReport({...s,outcome}),/unsupported/);
 const {elements,requests,streams}=await setup(false,false,{...s,outcome,readOnly:true,maxCalls:6},true,undefined,'http://local/?session=saved-id&page=1');
 assert.match(elements.outcome.textContent,/codex\/c1 \(unsupported\)/);assert.match(elements.outcome.textContent,/<b>Guaranteed improvement<\/b>/);assert.match(elements.outcome.textContent,/Duration unresolved/);assert.match(elements.outcome.textContent,/not exhaustively/);assert.equal(requests.length,0);assert.equal(streams.length,0);assert.equal(elements.run.disabled,true);
});

test('UI research is opt-in, sends separate query and renders saved collaboration coverage safely',async()=>{
 const {elements,requests,streams}=await setup();elements.researchMode.value='wikipedia';elements.researchQuery.value='Public topic';await elements.run.onclick!();
 assert.deepEqual(requests[0].research,{mode:'wikipedia',query:'Public topic'});assert.equal(elements.researchQuery.disabled,true);
 streams[0].onmessage!({data:JSON.stringify({type:'research.completed',sources:[{id:'wiki-42',uri:'https://en.wikipedia.org/?curid=42',text:'<script>untrusted source</script>'}]})});
 streams[0].onmessage!({data:JSON.stringify({type:'workflow.assessed',workflow:{research:{status:'completed',scope:'Limited background research'},scope:'One revision cycle',complete:false,rows:[{agent:'codex',reviewed:[],responded:[],expected:['claude'],missingReviews:['claude'],missingRevisions:['claude'],openQuestions:['Evidence needed']}]}})});
 assert.ok(elements.feed.children.some(x=>x.children[1].textContent.includes('<script>untrusted source</script>')));
 assert.ok(elements.feed.children.some(x=>x.children[1].textContent.includes('Coverage incomplete')));
 const plain=await setup();await plain.elements.run.onclick!();assert.equal(plain.requests[0].research,undefined);
});

function descendants(element:Element):Element[]{return [element,...element.children.flatMap(descendants)];}
function renderedText(element:Element):string{return descendants(element).map(e=>e.textContent).join('\n');}
const cardReview={reviews:[{peer:'claude',decision:'adopted',reason:'Add workload measurements.'},{peer:'grok',decision:'unresolved',reason:'Need contrary evidence.'}],revisedView:'Use a reversible pilot.',openQuestions:['Which stop condition?']};
const cardPosition={direction:'pilot',recommendation:'Run a six-week pilot.',rationale:'Measure before expanding.',revisions:[{peer:'claude',decision:'rejected',reason:'A full rollout is premature.'}],risks:['Service quality could decline.'],disagreements:['Duration remains disputed.'],nextSteps:['Team lead: stop if service quality declines.'],claims:[{id:'c1',kind:'assumption',text:'Scheduling is feasible.',evidenceIds:['source-1'],snapshotId:'snapshot-1'}]};

test('live peer-review and revision cards preserve decisions, questions, claims and exact expandable originals',async()=>{
 const {elements,streams}=await setup();await elements.run.onclick!();
 const originals=[JSON.stringify(cardReview),JSON.stringify(cardPosition)];
 for(const [i,text] of originals.entries())streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',round:i+2,agent:'codex',text,spendKnownUSD:0,spendIncomplete:true})});
 const cards=elements.feed.children.filter(e=>e.className.includes('response-card'));assert.equal(cards.length,2);
 assert.equal(cards[0].tagName,'article');assert.match(renderedText(cards[0].children[1]),/Revised view[\s\S]*Use a reversible pilot[\s\S]*Peer assessments[\s\S]*adopted[\s\S]*unresolved[\s\S]*Which stop condition/);
 assert.match(renderedText(cards[1].children[1]),/Recommendation[\s\S]*Run a six-week pilot[\s\S]*rejected[\s\S]*Duration remains disputed[\s\S]*Team lead[\s\S]*source-1[\s\S]*snapshot-1/);
 for(const [i,card] of cards.entries()){
  const detail=card.children.at(-1)!;assert.equal(detail.tagName,'details');assert.equal(detail.children[0].tagName,'summary');assert.equal(detail.children[0].textContent,'Original response');assert.equal(detail.children[1].textContent,originals[i]);
  assert.ok(!renderedText(card.children[1]).includes('"reviews":'));assert.ok(!renderedText(card.children[1]).includes('"revisions":'));
 }
 assert.match(elements.cost.textContent,/unknown costs/);
});
test('saved bookmark uses the same cards without new sessions or streams; fenced and legacy structured positions remain readable',async()=>{
 const {revisions,...legacy}=cardPosition;
 const entries=[{agent:'claude',round:2,text:'```json\n'+JSON.stringify(cardReview)+'\n```'},{agent:'claude',round:3,text:JSON.stringify(legacy)}];
 const saved={id:'saved-id',prompt:'Saved idea',readOnly:true,status:'completed',maxRounds:3,calls:6,spendKnownUSD:0,spendIncomplete:true,entries};
 const {elements,requests,streams}=await setup(false,false,saved,false,undefined,'http://localhost:3030/?session=saved-id');
 const cards=elements.feed.children.filter(e=>e.className.includes('response-card'));assert.equal(cards.length,2);assert.equal(requests.length,0);assert.equal(streams.length,0);
 assert.match(renderedText(cards[1]),/Revision responses were not recorded/);assert.match(renderedText(cards[0]),/Which stop condition/);
});
test('malformed and free-text replies fall back intact; subsequent structured replies still render',async()=>{
 const {elements,streams}=await setup();await elements.run.onclick!();
 const values=['Legacy free text','{broken',JSON.stringify({...cardReview,reviews:null}),JSON.stringify({...cardPosition,claims:[{id:'bad'}]})];
 for(const text of values)streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',round:2,agent:'claude',text,spendKnownUSD:0})});
 assert.deepEqual(elements.feed.children.map(e=>e.children[1].textContent),values);
 streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',round:3,agent:'claude',text:JSON.stringify(cardPosition),spendKnownUSD:0})});assert.ok(elements.feed.children.at(-1)!.className.includes('response-card'));
});
test('untrusted markup stays literal in every card field and original; no content creates HTML or interactive links',async()=>{
 const {elements,streams}=await setup();await elements.run.onclick!();
 const attack='<img src=x onerror=alert(1)>';
 const data={...cardPosition,recommendation:attack,rationale:attack,revisions:[{peer:attack,decision:attack,reason:attack}],risks:[attack],disagreements:[attack],nextSteps:[attack],claims:[{id:attack,kind:attack,text:attack,evidenceIds:[attack],snapshotId:attack}]};
 streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',round:3,agent:'codex',text:JSON.stringify(data),spendKnownUSD:0})});
 const card=elements.feed.children[0];assert.ok(card.className.includes('response-card'));const nodes=descendants(card);assert.ok(nodes.filter(n=>n.textContent.includes(attack)).length>=8);assert.ok(nodes.every(n=>!['img','script','a','iframe'].includes(n.tagName)));assert.ok(nodes.every(n=>!n.className.includes(attack)));assert.ok(nodes.some(n=>n.className==='decision decision-other'));
});
test('empty declarations are explicit and do not imply verified agreement',async()=>{
 const {elements,streams}=await setup();await elements.run.onclick!();
 streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',round:2,agent:'codex',text:JSON.stringify({reviews:[],revisedView:'Retain the proposal.',openQuestions:[]}),spendKnownUSD:0})});
 streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',round:3,agent:'claude',text:JSON.stringify({...cardPosition,revisions:[],risks:[],disagreements:[],claims:[]}),spendKnownUSD:0})});
 assert.match(renderedText(elements.feed),/No peer responses declared/);assert.match(renderedText(elements.feed),/No disagreements declared; this does not establish agreement/);assert.match(renderedText(elements.feed),/No claims declared; omitted assertions may remain/);
});

test('warning live and saved cards display canonical diagnostics while retaining original oversized responses',async()=>{
 const {responseValidation}=await import('../src/discussion-workflow.ts');
 const text=JSON.stringify({...cardReview,revisedView:'x'.repeat(1246)});
 const entry={agent:'codex',round:2,text,validation:responseValidation({round:2,text})};
 const live=await setup();await live.elements.run.onclick!();live.streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',...entry,spendKnownUSD:0})});
 const saved=await setup(false,false,{...bookmarkedSession,maxRounds:3,entries:[entry]},true,undefined,'http://local/?session=saved-id');
 for(const ui of [live,saved]){const card=ui.elements.feed.children.find(e=>e.className.includes('response-card'))!;assert.match(renderedText(card),/Length warning — usable/);assert.match(renderedText(card),/1246 characters; limit 1200; 46 over/);assert.equal(card.children.at(-1)!.children[1].textContent,text);assert.doesNotMatch(renderedText(card),/Schema checks passed/);}
 assert.equal(saved.requests.length,0);assert.equal(saved.streams.length,0);
});
test('invalid fallback retains text and warnings; valid and unavailable schemas are distinct from agreement',async()=>{
 const {responseValidation}=await import('../src/discussion-workflow.ts');const ui=await setup();await ui.elements.run.onclick!();
 for(const text of ['{broken','x'.repeat(12001),JSON.stringify(cardPosition)])ui.streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',round:3,agent:'codex',text,validation:responseValidation({round:3,text}),spendKnownUSD:0})});
 assert.equal(ui.elements.feed.children[0].children[1].textContent,'{broken');assert.match(renderedText(ui.elements.feed.children[0]),/invalid JSON/);assert.match(renderedText(ui.elements.feed.children[1]),/12001 characters; limit 12000/);assert.match(renderedText(ui.elements.feed.children[2]),/Schema checks passed — not a fact check or agreement/);
});

test('initial analysis renders Markdown headings, lists, emphasis, code and tables without executable HTML',async()=>{
 const ui=await setup();await ui.elements.run.onclick!();
 const original='## Retrieval options\n\nUse **lexical** and `symbol_id`.\n\n- Exact lookup\n- Conceptual search\n\n1. Measure\n2. Compare\n\n| Query | Route |\n| --- | --- |\n| Symbol | Lexical |\n\n<script>alert(1)</script> [unsafe](javascript:alert(1))\n\n```html\n<img src=x onerror=alert(1)>\n```';
 ui.streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',round:1,agent:'codex',text:original,spendKnownUSD:0})});
 const card=ui.elements.feed.children.at(-1)!;const tags=descendants(card).map(x=>x.tagName);
 for(const tag of ['h4','strong','code','ul','ol','table','thead','tbody','th','td','pre'])assert.ok(tags.includes(tag),tag);
 for(const tag of ['script','img','a','iframe'])assert.ok(!tags.includes(tag));
 const raw=card.children.at(-1)!;assert.equal(raw.tagName,'details');assert.equal(raw.children[1].textContent,original);
 assert.match(card.textContent,/<script>alert\(1\)<\/script>/);
});
test('recommendation sections retain dissent and unsupported checks in labeled disclosures, with no inferred consensus',async()=>{
 const ui=await setup();await ui.elements.run.onclick!();
 const outcome={recommendation:'Pilot lexical plus graph.',status:'direction-alignment',coverage:{valid:2,expected:2},proposalBy:'codex',supporters:['codex','claude'],positions:[{agent:'codex',position:{rationale:'Test first.',risks:['Incomplete graph.'],disagreements:['Exact hits should not end retrieval.']}}],nextSteps:['Collect questions.','Compare retrieval.'],unresolved:[{agent:'claude',text:'Code authority remains disputed.'}],caveat:'Peer coverage incomplete; not verified correctness.',claimAssessment:{scope:'Declared claims only.',declaredBy:['codex'],unassessed:['claude'],checks:[{agent:'codex',claim:{id:'c1',text:'Unmeasured gain.',evidenceIds:[],snapshotId:null},status:'unsupported',issues:['No evidence.']}]}};
 const event=()=>ui.streams[0].onmessage!({data:JSON.stringify({type:'discussion.assessed',outcome})});event();
 const root=ui.elements.outcome;
 assert.match(root.textContent,/Aligned direction · proposals differ/);assert.match(root.textContent,/Peer coverage incomplete/);
 const all=descendants(root);assert.ok(all.some(e=>e.tagName==='ol'&&/Collect questions/.test(e.textContent)));
 const detail=root.children.filter(e=>e.tagName==='details');assert.equal(detail.length,2);
 assert.match(detail[0].children[0].textContent,/All unresolved.*\(1\)/);assert.match(detail[0].textContent,/Code authority/);
 assert.match(detail[1].children[0].textContent,/1 unsupported/);assert.match(detail[1].textContent,/No evidence/);
 const before=root.textContent;event();assert.equal(root.textContent,before,'rerender replaces rather than duplicates');
 assert.ok(!all.some(e=>e.tagName==='a'||e.tagName==='script'));
});


test('OpenAI-only UI requires two distinct models, posts both slots and reopens both originals',async()=>{
 const health={agents:['codex','codex-2'],availableProviders:[{id:'codex',label:'OpenAI Codex',defaultModel:''}],availableParticipants:[{id:'codex',provider:'codex',label:'OpenAI · Participant 1',defaultModel:''},{id:'codex-2',provider:'codex',label:'OpenAI · Participant 2',defaultModel:''}]};
 const {elements,rows,requests}=await setup(false,false,undefined,false,undefined,undefined,health);
 assert.equal(rows.length,2);assert.equal(elements.run.disabled,true);assert.match(elements.selectionError.textContent,/Choose a model/);
 rows[0].model.value='model-a';rows[1].model.value='model-a';rows[1].model.oninput!();assert.equal(elements.run.disabled,true);
 rows[1].model.value='model-b';rows[1].model.oninput!();assert.equal(elements.run.disabled,false);assert.equal(elements.plannedCalls.textContent,6);
 await elements.run.onclick!();assert.deepEqual(requests[0].selection,{providers:['codex','codex-2'],models:{codex:'model-a','codex-2':'model-b'},efforts:{'codex':'medium','codex-2':'medium'}});
 const saved={id:'saved-id',prompt:'Saved two-model idea',maxRounds:3,status:'completed',readOnly:true,calls:6,maxCalls:6,spendKnownUSD:0,spendIncomplete:true,selection:requests[0].selection,entries:[1,2,3].flatMap(round=>['codex','codex-2'].map(agent=>({round,agent,text:agent+' original '+round}))),outcome:null};
 const reopened=await setup(false,false,saved,true,undefined,undefined,health);reopened.elements.savedSessions.value='saved-id';await reopened.elements.openSaved.onclick!();
 assert.equal(reopened.requests.length,0);assert.equal(reopened.rows[1].model.value,'model-b');assert.match(reopened.elements.feed.textContent,/codex-2 original 3/);assert.equal(reopened.elements.run.disabled,true);
});

test('decision brief presents attributed alternatives and peer responses in live and reopened views without inference',async()=>{
 const comparison={alternative:'<img src=x onerror=alert(1)>Keep current process',tradeoff:'Less effort, less feedback.',switchCondition:'Switch after two weeks without benefit.'};
 const position={direction:'pilot',recommendation:'Run a pilot.',rationale:'Measure demand.',risks:[],disagreements:['Timing remains unresolved.'],nextSteps:['Owner: measure after two weeks.'],comparison,revisions:[{peer:'claude',decision:'rejected',reason:'Unchanged: no material new evidence.'}],claims:[]};
 const outcome={recommendation:position.recommendation,status:'direction-alignment',coverage:{valid:2,expected:2},proposalBy:'codex',supporters:['codex','claude'],positions:[{agent:'codex',position},{agent:'claude',position:{...position,comparison:{...comparison,alternative:null},revisions:[]}}],nextSteps:position.nextSteps,unresolved:[],caveat:'Not verified consensus'};
 const live=await setup();await live.elements.run.onclick!();
 live.streams[0].onmessage!({data:JSON.stringify({type:'discussion.assessed',outcome})});
 const text=live.elements.outcome.textContent;
 for(const expected of ['codex · Decision brief','claude · Decision brief',comparison.alternative,comparison.switchCondition,'No feasible alternative declared.','Unchanged: no material new evidence.','not independently verified','Timing remains unresolved.'])assert.ok(text.includes(expected),expected);
 const tags=(e:Element):string[]=>[e.tagName,...e.children.flatMap(tags)];assert.ok(!tags(live.elements.outcome).includes('img'));
 const raw=JSON.stringify(position);
 const saved={id:'saved-id',prompt:'Saved brief',maxRounds:3,status:'completed',readOnly:true,calls:6,spendKnownUSD:0,spendIncomplete:true,entries:[{agent:'codex',round:3,text:raw}],outcome};
 const reopened=await setup(false,false,saved);reopened.elements.savedSessions.value='saved-id';await reopened.elements.openSaved.onclick!();
 assert.equal(reopened.elements.outcome.textContent,text);assert.ok(reopened.elements.feed.textContent.includes(raw));assert.ok(reopened.elements.feed.textContent.includes(comparison.switchCondition));assert.equal(reopened.streams.length,0);assert.equal(reopened.requests.length,0);
});
test('targeted UI chooses roles and preset, limits calls, locks inputs and renders the recorded accounting',async()=>{
 const ui=await setup();const e=ui.elements;
 await e.usePair.onclick!();e.acceptanceChecks.value='No stale cache hits\nSame immutable snapshot';
 assert.equal(e.workflowMode.value,'targeted');assert.equal(e.author.value,'claude');assert.equal(e.plannedCalls.textContent,3);assert.equal(e.rounds.disabled,true);
 await e.run.onclick!();const req=ui.requests[0];assert.equal(req.workflowMode,'targeted');assert.equal(req.author,'claude');assert.deepEqual(req.checks,['No stale cache hits','Same immutable snapshot']);assert.equal(req.selection.models.claude,'claude-sonnet-5-5');assert.equal(req.selection.models.codex,'gpt-6-astra');assert.equal(e.send.disabled,true);assert.equal(e.workflowMode.disabled,true);
 const targeted={author:'claude',reviewer:'codex',complete:true,revision:'not-needed',reason:'No material actionable finding; original draft retained.',draft:{recommendation:'Keep <script> literal'},final:{recommendation:'Keep <script> literal',rationale:'Assumption: inputs are stable.',risks:[],nextSteps:['Test variants.']},review:{summary:'Fine',findings:[]},responses:[],changedFields:[]};
 ui.streams[0].onmessage!({data:JSON.stringify({type:'targeted.assessed',targeted})});assert.match(e.outcome.textContent,/original draft retained/);assert.match(e.outcome.textContent,/not proof of correctness/);
 ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'completed',spendKnownUSD:0,spendIncomplete:true,tokenAccounting:{knownTotalTokens:390,missingCalls:1,scope:'Reported totals only.',calls:[{agent:'claude',stage:'draft',totalTokens:130,primaryTokens:105,auxiliaryTokens:25,unclassifiedTokens:0},{agent:'codex',stage:'review',totalTokens:null,primaryTokens:null,auxiliaryTokens:null,unclassifiedTokens:null}]}})});
 assert.match(e.tokenTotals.textContent,/390 known total tokens/);assert.match(e.tokenTotals.textContent,/1 calls missing/);assert.match(e.tokenDetails.textContent,/Helpers/);assert.match(e.tokenDetails.textContent,/unknown/);assert.match(e.jsonReport.href,/format=json/);assert.equal(e.jsonReport.style.display,'inline');
});
test('saved targeted view restores changes, unresolved findings and identical accounting without inference',async()=>{
 const targeted={author:'claude',reviewer:'codex',complete:true,revision:'completed',reason:'Declared changes.',draft:{recommendation:'Old'},final:{recommendation:'New',rationale:'Why',risks:[],nextSteps:['Test']},review:{summary:'Issue',findings:[{id:'f1',claimId:'c1',severity:'material',category:'correctness',failureScenario:'Dirty edits collide',consequence:'Stale result',correction:'Hash contents',acceptanceTest:'Compare variants'}]},responses:[{findingId:'f1',decision:'unresolved',reason:'Unknown dependency',change:'Safer fallback'}],changedFields:['recommendation']};
 const saved={id:'saved-id',prompt:'Saved',workflowMode:'targeted',research:{mode:'wikipedia',query:'Saved public topic'},targetedConfig:{author:'claude',reviewer:'codex',checks:['Correct outputs']},targeted,maxRounds:3,status:'completed',readOnly:true,calls:3,spendKnownUSD:0,spendIncomplete:true,entries:[],tokenAccounting:{knownTotalTokens:300,missingCalls:0,scope:'No double-counting',calls:[]}};
 const ui=await setup(false,false,saved,true);ui.elements.savedSessions.value='saved-id';await ui.elements.openSaved.onclick!();assert.equal(ui.elements.workflowMode.value,'targeted');assert.equal(ui.elements.acceptanceChecks.value,'Correct outputs');assert.match(ui.elements.outcome.textContent,/f1 — unresolved/);assert.match(ui.elements.outcome.textContent,/Changed fields: recommendation/);assert.match(ui.elements.tokenTotals.textContent,/300/);assert.equal(ui.requests.length,0);assert.equal(ui.streams.length,0);
 assert.equal(ui.elements.researchMode.value,'wikipedia');assert.equal(ui.elements.researchQuery.value,'Saved public topic');
});
test('decision brief legacy absence and malformed comparison stay explicit in the UI',async()=>{
 const legacy={direction:'pilot',recommendation:'Pilot.',rationale:'Measure.',risks:[],disagreements:[],nextSteps:['Test.']};
 const ui=await setup();await ui.elements.run.onclick!();
 ui.streams[0].onmessage!({data:JSON.stringify({type:'discussion.assessed',outcome:{recommendation:'Pilot.',status:'insufficient',coverage:{valid:1,expected:2},positions:[{agent:'codex',position:legacy}],nextSteps:[],unresolved:[{agent:'claude',text:'Final-round response missing.'}],caveat:'Not consensus',supporters:[]}})});
 assert.match(ui.elements.outcome.textContent,/Decision comparisonNot recorded/);assert.match(ui.elements.outcome.textContent,/Declared response to peer reviewNot recorded/);assert.match(ui.elements.outcome.textContent,/response missing/);
 const raw=JSON.stringify({...legacy,comparison:{alternative:'x'}});
 ui.streams[0].onmessage!({data:JSON.stringify({type:'agent.completed',agent:'codex',round:3,text:raw,validation:{status:'invalid',issues:[]}})});
 assert.ok(ui.elements.feed.textContent.includes(raw));assert.doesNotMatch(ui.elements.feed.textContent,/Switch condition/);
});

test('workspace navigation separates setup/history without model discovery or starting a discussion',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,'http://local/',{},undefined,false),e=ui.elements;
 assert.equal(e.newWorkspace.hidden,false);assert.equal(e.historyWorkspace.hidden,true);assert.equal(e.sessionResults.hidden,true);
 await e.navSaved.onclick!();assert.equal(e.newWorkspace.hidden,true);assert.equal(e.historyWorkspace.hidden,false);assert.equal(e.navSaved.attributes['aria-pressed'],'true');assert.equal(e.setupState.textContent,'Saved history');
 assert.equal(ui.address!.searchParams.get('view'),'saved');await e.run.onclick!();assert.equal(ui.requests.length,0);
 await e.navNew.onclick!();assert.equal(e.newWorkspace.hidden,false);assert.equal(e.sessionResults.hidden,true);assert.equal(e.navNew.attributes['aria-pressed'],'true');
 assert.equal(ui.modelRequests.length,0);assert.equal(ui.streams.length,0);assert.equal(ui.requests.length,0);assert.equal(ui.address!.searchParams.get('view'),'new');
});

test('opening multiple saved records preserves a complete unfinished three-row draft and clears old results on return',async()=>{
 const saved={id:'saved-id',prompt:'Historical task <img src=x>',context:'Historical context',status:'completed',readOnly:true,maxRounds:1,calls:2,spendKnownUSD:0,selection:{providers:['codex','claude'],models:{codex:'historical-a',claude:'historical-b'}},entries:[{agent:'codex',round:1,text:'Historical answer'}],tokenAccounting:{knownTotalTokens:42,missingCalls:0,calls:[]}};
 const ui=await setup(false,false,saved,false,undefined,'http://local/',{...mixedHealth,research:{web:true}}),e=ui.elements;
 e.participantCount.value='3';e.participantCount.onchange!();
 e.question.value='Private unfinished idea';e.context.value='Private constraints';e.acceptanceChecks.value='Stop condition\nRollback';e.researchMode.value='both';e.researchMode.onchange!();e.researchQuery.value='public keywords';e.researchQuery.oninput!();e.rounds.value='2';e.rounds.onchange!();e.author.value='codex';e.author.onchange!();e.contextDetails.open=true;e.advancedSettings.open=true;
 const firstModel=ui.rows[0].model.value;
 await e.navSaved.onclick!();assert.equal(e.question.value,'Private unfinished idea');
 e.savedSessions.value='saved-id';await e.openSaved.onclick!();
 assert.equal(e.sessionResults.hidden,false);assert.equal(e.newWorkspace.hidden,true);assert.equal(e.run.disabled,true);assert.match(e.savedConfiguration.textContent,/Historical task <img src=x>.*Historical context/s);assert.match(e.tokenTotals.textContent,/42/);
 assert.equal(ui.requests.length,0);await e.run.onclick!();assert.equal(ui.requests.length,0);
 saved.id='second-id';saved.prompt='A second saved task';e.savedSessions.value='second-id';await e.openSaved.onclick!();assert.match(e.savedConfiguration.textContent,/A second saved task/);
 await e.navNew.onclick!();
 assert.equal(e.question.value,'Private unfinished idea');assert.equal(e.context.value,'Private constraints');assert.equal(e.acceptanceChecks.value,'Stop condition\nRollback');assert.equal(e.researchMode.value,'both');assert.equal(e.researchQuery.value,'public keywords');assert.equal(e.rounds.value,'2');assert.equal(e.author.value,'codex');assert.equal(e.contextDetails.open,true);assert.equal(e.advancedSettings.open,true);
 assert.equal(ui.rows.length,3);assert.equal(ui.rows[0].model.value,firstModel);assert.equal(ui.rows[0].model.hidden,false);assert.equal(ui.rows[2].provider.value,'');assert.equal(ui.rows[2].model.value,'');assert.equal(e.run.disabled,true);
 assert.equal(e.sessionResults.hidden,true);assert.equal(e.feed.textContent,'');assert.equal(e.savedConfiguration.textContent,'');assert.equal(e.tokenDetails.textContent,'');assert.equal(e.cost.textContent,'Unknown');assert.equal(e.calls.textContent,'0');assert.equal(e.report.style.display,'none');assert.equal(e.report.href,'#');assert.equal(ui.address!.searchParams.has('session'),false);assert.doesNotMatch(ui.address!.href,/Private|constraints|keywords/);
 assert.equal(ui.modelRequests.length,0);assert.equal(ui.requests.length,0);assert.equal(ui.streams.length,0);
});

test('restored targeted draft starts with its own roles, criteria and public query rather than the saved configuration',async()=>{
 const saved={id:'saved-id',prompt:'Historical',status:'completed',readOnly:true,maxRounds:1,calls:1,spendKnownUSD:0,selection:{providers:['codex','claude'],models:{codex:'old-a',claude:'old-b'}},entries:[]};
 const ui=await setup(false,false,saved,false,undefined,undefined,{research:{web:true}}),e=ui.elements;
 e.workflowMode.value='targeted';e.workflowMode.onchange!();e.author.value='codex';e.author.onchange!();e.acceptanceChecks.value='A measurable outcome';e.question.value='Current task';e.context.value='Current context';e.researchMode.value='wikipedia';e.researchMode.onchange!();e.researchQuery.value='Public topic';e.researchQuery.oninput!();
 await e.navSaved.onclick!();e.savedSessions.value='saved-id';await e.openSaved.onclick!();await e.navNew.onclick!();
 assert.equal(ui.rows[0].role.textContent,'Draft author');assert.equal(ui.rows[1].role.textContent,'Reviewer');assert.equal(e.run.disabled,false);
 await e.run.onclick!();assert.equal(e.sessionResults.hidden,false);assert.equal(e.navNew.disabled,true);assert.equal(e.navSaved.disabled,true);await e.navSaved.onclick!();assert.equal(e.historyWorkspace.hidden,true);
 assert.deepEqual(ui.requests[0],{url:'/api/sessions',prompt:'Current task',context:'Current context',grounding:'none',maxRounds:3,selection:{providers:['codex','claude'],models:{codex:'codex-default',claude:'claude-fixture'},efforts:{'codex':'medium','claude':'medium'}},workflowMode:'targeted',author:'codex',checks:['A measurable outcome'],research:{mode:'wikipedia',query:'Public topic'}});
});

test('research query is revealed only when opted in, validated before Start and retained while off',async()=>{
 const ui=await setup(),e=ui.elements;assert.equal(e.researchQueryField.hidden,true);assert.equal(e.researchError.textContent,'');
 e.researchMode.value='wikipedia';e.researchMode.onchange!();assert.equal(e.researchQueryField.hidden,false);assert.equal(e.run.disabled,true);assert.equal(e.researchQuery.attributes['aria-invalid'],'true');await e.run.onclick!();assert.equal(ui.requests.length,0);
 for(const query of ['   ','a'.repeat(301)]){e.researchQuery.value=query;e.researchQuery.oninput!();assert.equal(e.run.disabled,true);}
 e.researchQuery.value='Public topic';e.researchQuery.oninput!();assert.equal(e.run.disabled,false);e.researchMode.value='none';e.researchMode.onchange!();assert.equal(e.researchQueryField.hidden,true);assert.equal(e.researchQuery.value,'Public topic');assert.equal(e.researchError.textContent,'');
 e.question.value='  ';e.question.oninput!();assert.equal(e.run.disabled,true);assert.equal(e.question.attributes['aria-invalid'],'true');
 e.question.value='A decision';e.question.oninput!();await e.run.onclick!();assert.equal(Object.hasOwn(ui.requests[0],'research'),false);
});

for(const bookmark of ['?view=saved','?q=older&page=2','?session=saved-id'])test(`saved workspace bookmark ${bookmark} opens history and reports restoration failures visibly`,async()=>{
 const ui=await setup(false,false,undefined,false,async()=>({ok:false,json:async()=>({error:'History temporarily unavailable'})}),'http://local/'+bookmark);
 assert.equal(ui.elements.historyWorkspace.hidden,false);assert.equal(ui.elements.newWorkspace.hidden,true);assert.match(ui.elements.savedStatus.textContent,/temporarily unavailable/);assert.equal(ui.urlWrites.length,0);assert.equal(ui.requests.length,0);assert.equal(ui.streams.length,0);
});

test('history in flight locks navigation and finished-session New clears results without discarding the editable setup',async()=>{
 let hold=false,release!:()=>void;
 const ui=await setup(false,false,undefined,false,async()=>{if(hold)await new Promise<void>(resolve=>{release=resolve;});return {ok:true,json:async()=>({sessions:[],q:'',page:1,total:0,discoveredTotal:0,totalPages:1,unavailable:0})};}),e=ui.elements;
 e.context.value='Keep this context';await e.run.onclick!();hold=true;ui.streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'completed'})});
 assert.equal(e.navSaved.disabled,true);assert.equal(e.navNew.disabled,true);await e.navSaved.onclick!();assert.equal(e.historyWorkspace.hidden,true);
 release();await new Promise(resolve=>setImmediate(resolve));await e.navNew.onclick!();
 assert.equal(e.context.value,'Keep this context');assert.equal(e.question.value,'Synthetic question');assert.equal(e.sessionResults.hidden,true);assert.equal(e.calls.textContent,'0');assert.equal(ui.requests.length,1);assert.equal(ui.streams[0].closed,true);
});

test('full discussion explains optional feedback, reports queue timing and closes the input window at the final round',async()=>{
 const ui=await setup(),e=ui.elements;await e.run.onclick!();assert.match(e.feedbackHint.textContent,/Optional.*round 2.*without waiting/);assert.equal(e.send.disabled,true);
 const event=(data:Record<string,unknown>)=>ui.streams[0].onmessage!({data:JSON.stringify(data)});
 event({type:'round.started',round:1});e.intervene.value='Check watermarking; treat this as unverified.';e.intervene.oninput!();assert.equal(e.send.disabled,false);
 await e.send.onclick!();assert.deepEqual(ui.requests.at(-1),{url:'/api/sessions/synthetic-session/interventions',message:'Check watermarking; treat this as unverified.'});assert.equal(e.intervene.value,'');
 event({type:'human.intervention',message:'Check watermarking',appliesFromRound:2});assert.match(e.feedbackStatus.textContent,/Queued from round 2.*later stop/);
 event({type:'round.completed',round:1});assert.match(e.workflowSteps.children[0].className,/is-done/);event({type:'round.started',round:2});assert.match(e.workflowSetup.className,/is-running/);assert.match(e.feedbackHint.textContent,/round 3/);
 event({type:'round.started',round:3});e.intervene.value='Keep this for later';e.intervene.oninput!();assert.equal(e.feedbackStatus.textContent,'');assert.equal(e.send.disabled,true);assert.match(e.feedbackHint.textContent,/No later round/);const before=ui.requests.length;await e.send.onclick!();assert.equal(ui.requests.length,before);
 event({type:'session.finished',status:'completed'});await new Promise(resolve=>setImmediate(resolve));assert.match(e.workflowSetup.className,/is-complete/);assert.equal(e.prepareFeedback.hidden,false);assert.equal(e.prepareFeedback.disabled,false);assert.equal(e.intervene.value,'Keep this for later');assert.match(e.feedbackHint.textContent,/cannot change its saved answer/);
});

test('targeted review keeps feedback as an optional draft for later; connection loss never claims a safe next round',async()=>{
 const ui=await setup(),e=ui.elements;await e.usePair.onclick!();await e.run.onclick!();e.intervene.value='A missing constraint';e.intervene.oninput!();assert.equal(e.send.hidden,true);assert.equal(e.prepareFeedback.hidden,true);assert.equal(e.intervene.disabled,false);assert.match(e.feedbackHint.textContent,/fixed.*write feedback now/);await e.send.onclick!();assert.equal(ui.requests.length,1);
 ui.streams[0].onerror!();assert.match(e.feedbackHint.textContent,/timing is unknown/);assert.equal(e.prepareFeedback.hidden,true);assert.equal(e.send.disabled,true);assert.equal(e.intervene.value,'A missing constraint');
});

test('saved feedback prepares a new editable setup with original assessment and no automatic inference or research',async()=>{
 const saved={id:'saved-id',prompt:'Original question',context:'Original constraints',status:'completed',readOnly:true,maxRounds:3,calls:2,spendKnownUSD:0,workflowMode:'targeted',targetedConfig:{author:'claude',checks:['A measurable stop']},targeted:{...noRevision,final:{recommendation:'Original pilot <img src=x>',rationale:'Unverified assumption'},responses:[],changedFields:[]},research:{mode:'wikipedia',query:'Old query'},selection:{providers:['codex','claude'],models:{codex:'saved-a',claude:'saved-b'}},entries:[]};
 const snapshot=JSON.stringify(saved),ui=await setup(false,false,saved),e=ui.elements;e.savedSessions.value='saved-id';await e.openSaved.onclick!();e.intervene.value='Check the watermark claim against documentation.';e.intervene.oninput!();assert.equal(e.prepareFeedback.disabled,false);await e.prepareFeedback.onclick!();
 assert.equal(e.newWorkspace.hidden,false);assert.equal(e.historyWorkspace.hidden,true);assert.equal(e.sessionResults.hidden,true);assert.equal(e.question.value,'Original question');assert.equal(e.author.value,'claude');assert.equal(e.acceptanceChecks.value,'A measurable stop');assert.equal(e.workflowMode.value,'targeted');assert.deepEqual(ui.rows.map(row=>row.model.value),['saved-a','saved-b']);assert.equal(e.researchMode.value,'none');assert.equal(e.researchQuery.value,'');assert.equal(e.contextDetails.open,true);
 assert.match(e.context.value,/Original constraints.*FOLLOW-UP TO RECORDED DISCUSSION saved-id.*Original pilot <img src=x>.*HUMAN FEEDBACK \(UNVERIFIED\).*watermark claim/s);assert.match(e.context.value,/Historical source references are not new evidence/);assert.match(e.workspaceNotice.textContent,/original is unchanged; no model calls/);assert.equal(JSON.stringify(saved),snapshot);assert.equal(ui.requests.length,0);assert.equal(ui.streams.length,0);assert.equal(ui.modelRequests.length,0);
 await e.run.onclick!();assert.equal(ui.requests.length,1);assert.equal(Object.hasOwn(ui.requests[0],'research'),false);assert.match(ui.requests[0].context,/watermark claim/);assert.equal(ui.requests[0].prompt,'Original question');assert.equal(e.workspaceNotice.hidden,true);assert.equal(e.workspaceNotice.textContent,'');
});

test('follow-up context is never silently clipped; oversize context blocks Start until edited',async()=>{
 const saved={id:'saved-id',prompt:'Original',context:'c'.repeat(6000),status:'completed',readOnly:true,maxRounds:3,calls:2,spendKnownUSD:0,workflowMode:'discussion',selection:{providers:['codex','claude'],models:{codex:'a',claude:'b'}},outcome:{recommendation:'A prior proposal',unresolved:[{text:'Unverified premise'}]},entries:[]};
 const ui=await setup(false,false,saved),e=ui.elements;e.savedSessions.value='saved-id';await e.openSaved.onclick!();e.intervene.value='Reconsider it';e.intervene.oninput!();await e.prepareFeedback.onclick!();
 assert.ok(e.context.value.startsWith(saved.context));assert.ok(e.context.value.length>6000);assert.match(e.context.value,/Unverified premise/);assert.match(e.contextError.textContent,/No text was omitted/);assert.equal(e.setupState.textContent,'Setup needed');assert.equal(e.run.disabled,true);await e.run.onclick!();assert.equal(ui.requests.length,0);
 e.context.value='User-edited context and feedback';e.context.oninput!();assert.equal(e.run.disabled,false);await e.run.onclick!();assert.equal(ui.requests[0].context,e.context.value);
});

test('follow-up missing historical facts stay explicit, and records that are no longer read-only cannot replace the setup',async()=>{
 const saved={id:'saved-id',prompt:'Legacy',status:'completed',readOnly:true,maxRounds:1,calls:0,spendKnownUSD:0,entries:[]};const ui=await setup(false,false,saved),e=ui.elements;e.savedSessions.value='saved-id';await e.openSaved.onclick!();
 e.intervene.value='Feedback';e.intervene.oninput!();saved.readOnly=false;await e.prepareFeedback.onclick!();assert.match(e.feedbackStatus.textContent,/Follow-up not prepared/);assert.equal(e.intervene.value,'Feedback');assert.equal(e.newWorkspace.hidden,true);assert.equal(ui.requests.length,0);
 saved.readOnly=true;await e.prepareFeedback.onclick!();assert.match(e.context.value,/No structured final assessment was recorded/);assert.ok(ui.rows.every(row=>row.provider.value===''&&row.model.value===''));assert.equal(e.run.disabled,true);assert.equal(ui.requests.length,0);assert.equal(ui.modelRequests.length,0);
});

test('new participants default to medium independently, dispatch changes and lock reasoning while running',async()=>{
 const ui=await setup(),e=ui.elements;assert.ok(ui.rows.every(row=>row.effort.value==='medium'));assert.equal(ui.modelRequests.length,0);
 ui.rows[0].effort.value='low';ui.rows[0].effort.onchange!();ui.rows[1].effort.value='high';ui.rows[1].effort.onchange!();e.workflowMode.value='targeted';e.workflowMode.onchange!();
 assert.match(e.workflowSteps.children[0].textContent,/high effort/);assert.match(e.workflowSteps.children[1].textContent,/low effort/);assert.match(e.workflowSteps.children[2].textContent,/high effort/);
 await e.run.onclick!();assert.deepEqual(ui.requests[0].selection.efforts,{codex:'low',claude:'high'});assert.ok(ui.rows.every(row=>row.effort.disabled));assert.equal(ui.modelRequests.length,0);
});

test('model-reported choices narrow reasoning without silently replacing an unsupported selected level',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,{},async()=>({ok:true,json:async()=>({models:['codex-default'],labels:{},efforts:{'codex-default':['medium']},total:1})}));
 ui.rows[0].effort.value='high';ui.rows[0].effort.onchange!();await ui.rows[0].refreshModels.onclick!();assert.equal(ui.rows[0].effort.value,'high');assert.equal(ui.elements.run.disabled,true);assert.match(ui.rows[0].card.textContent,/unavailable; choose another/);await ui.elements.run.onclick!();assert.equal(ui.requests.length,0);
 ui.rows[0].effort.value='@default';ui.rows[0].effort.onchange!();assert.equal(ui.elements.run.disabled,false);await ui.elements.run.onclick!();assert.equal(ui.requests[0].selection.efforts.codex,null);
});

test('explicit saved reasoning reopens without discovery, survives setup restoration and copies into follow-up',async()=>{
 const saved={id:'saved-id',prompt:'Recorded',status:'completed',readOnly:true,maxRounds:3,calls:0,spendKnownUSD:0,workflowMode:'targeted',targetedConfig:{author:'claude',checks:[]},selection:{providers:['codex','claude'],models:{codex:'a',claude:'b'},efforts:{codex:'xhigh',claude:'max'}},entries:[]};const ui=await setup(false,false,saved),e=ui.elements;
 ui.rows[0].effort.value='low';ui.rows[0].effort.onchange!();e.savedSessions.value='saved-id';await e.openSaved.onclick!();assert.equal(ui.rows[0].effort.value,'xhigh');assert.equal(ui.rows[1].effort.value,'max');assert.match(e.savedConfiguration.textContent,/Requested reasoning: codex · xhigh effort.*claude · max effort/);assert.equal(ui.modelRequests.length,0);
 await e.navNew.onclick!();assert.equal(ui.rows[0].effort.value,'low');assert.equal(ui.rows[1].effort.value,'medium');await e.navSaved.onclick!();e.savedSessions.value='saved-id';await e.openSaved.onclick!();e.intervene.value='New constraint';e.intervene.oninput!();await e.prepareFeedback.onclick!();assert.equal(ui.rows[0].effort.value,'xhigh');assert.equal(ui.rows[1].effort.value,'max');assert.equal(ui.requests.length,0);assert.equal(ui.modelRequests.length,0);
});

test('legacy saved effort remains unrecorded rather than relabeled medium; fresh follow-up defaults to medium',async()=>{
 const saved={id:'saved-id',prompt:'Legacy',status:'completed',readOnly:true,maxRounds:3,calls:0,spendKnownUSD:0,workflowMode:'targeted',targetedConfig:{author:'claude',checks:[]},selection:{providers:['codex','claude'],models:{codex:'a',claude:'b'}},entries:[]};const ui=await setup(false,false,saved),e=ui.elements;e.savedSessions.value='saved-id';await e.openSaved.onclick!();assert.ok(ui.rows.every(row=>row.effort.value==='@legacy'));assert.match(e.savedConfiguration.textContent,/not recorded \(legacy workflow settings\)/);assert.match(e.workflowSteps.children[0].textContent,/low effort \(legacy\)/);
 e.intervene.value='New information';e.intervene.oninput!();await e.prepareFeedback.onclick!();assert.ok(ui.rows.every(row=>row.effort.value==='medium'));assert.equal(saved.selection.hasOwnProperty('efforts'),false);assert.equal(ui.modelRequests.length,0);
});

test('Ollama loads model-specific reasoning only on request, selects medium when supported, and sends booleans exactly',async()=>{
 const ui=await setup(false,false,undefined,false,undefined,undefined,ollamaHealth,async url=>{const p=new URLSearchParams(url.split('?')[1]);return {ok:true,json:async()=>p.has('model')?{values:['low','medium','high',true,false]}:{models:[p.get('provider')==='ollama-local'?'local:a':'cloud:a'],total:1,source:'local-ollama-registry'}};}),e=ui.elements;
 for(const [index,row] of ui.rows.entries()){await row.refreshModels.onclick!();row.picker.value=index?'cloud:a':'local:a';row.picker.onchange!();assert.equal(row.effort.value,'@default');}
 assert.equal(ui.modelRequests.length,2);for(const row of ui.rows){await row.loadReasoning.onclick!();assert.equal(row.effort.value,'medium');}
 assert.equal(ui.modelRequests.length,4);assert.equal(ui.requests.length,0);ui.rows[0].effort.value='@false';ui.rows[0].effort.onchange!();ui.rows[1].effort.value='high';ui.rows[1].effort.onchange!();await e.run.onclick!();assert.deepEqual(ui.requests[0].selection.efforts,{'ollama-local':false,'ollama-cloud':'high'});
});

test('pending reasoning blocks Start; late results do not overwrite a provider changed during metadata loading',async()=>{
 let resolve!:(value:{ok:boolean;json:()=>Promise<any>})=>void;
 const ui=await setup(false,false,undefined,false,undefined,undefined,mixedHealth,async()=>new Promise(r=>{resolve=r;})),row=ui.rows[0],e=ui.elements;row.provider.value='ollama-cloud';row.provider.onchange!();row.model.value='cloud:a';row.model.oninput!();const loading=row.loadReasoning.onclick!();assert.equal(e.run.disabled,true);assert.equal(e.setupState.textContent,'Loading model choices');await e.run.onclick!();assert.equal(ui.requests.length,0);
 row.provider.value='codex';row.provider.onchange!();row.model.value='fresh-model';row.model.oninput!();row.effort.value='low';row.effort.onchange!();resolve({ok:true,json:async()=>({values:['medium','high']})});await loading;assert.equal(row.effort.value,'low');assert.equal(row.model.value,'fresh-model');assert.equal(e.run.disabled,false);assert.equal(ui.requests.length,0);
});
