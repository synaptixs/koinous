import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
class Element {
  tagName=''; id=''; type=''; value=''; checked=false; disabled=false; className=''; htmlFor=''; maxLength=0; placeholder=''; autocomplete=''; href='';
  style={display:''}; children: Element[]=[];
  private ownText='';
  get textContent():string{return this.children.length?this.ownText+this.children.map(c=>c.textContent).join(''):this.ownText;}
  set textContent(value:string){this.ownText=value;this.children=[];}
  start=1;
  onclick?:()=>Promise<void>; onchange?:()=>void; oninput?:()=>void;
  append(...children:Element[]){this.children.push(...children);}
  replaceChildren(){this.children=[];this.ownText='';}
}
async function setup(failedHealth=false,failedPost=false,saved?:Record<string,any>,real=false,historyFetch?:(url:string)=>Promise<{ok:boolean;json:()=>Promise<any>}>,initialURL?:string,healthOverride:Record<string,unknown>={}) {
  const elements=Object.fromEntries(['stageTags','workflowMode','author','acceptanceChecks','usePair','roleNote','tokenTotals','tokenDetails','jsonReport','researchMode','researchQuery','savedProvider','savedModel','savedFrom','savedTo','savedSearch','searchSaved','clearSaved','previousSaved','nextSaved','savedPage','savedSessions','openSaved','refreshSaved','savedStatus','reviewNotice','context','outcome','plannedCalls','maxCalls','providers','providerChoices','selectionError','run','rounds','question','feed','status','calls','cost','report','send','cancel','evidence','intervene'].map(id=>[id,new Element()]));
  elements.workflowMode.value='discussion';elements.rounds.value='3';elements.question.value='Synthetic question';
  const requests:Array<Record<string,any>>=[];const historyRequests:string[]=[];
  const streams:FakeEvents[]=[];
  class FakeEvents {
    onmessage?:(e:{data:string})=>void; onerror?:()=>void; closed=false;
    constructor(_url:string){streams.push(this);}close(){this.closed=true;}
  }
  const fetch=async(url:string,options?:{body?:string})=>{
    if(url==='/api/health')return {ok:!failedHealth,json:async()=>({mode:real?'real':'mock',inferenceEnabled:false,agents:['codex','claude'],availableProviders:[{id:'codex',label:'OpenAI Codex',defaultModel:'codex-default'},{id:'claude',label:'Anthropic Claude',defaultModel:''},{id:'grok',label:'Grok Build',defaultModel:'grok-4.7'}],...healthOverride})};
    if(url.startsWith('/api/sessions?')&&!options){historyRequests.push(url);if(historyFetch)return historyFetch(url);return {ok:true,json:async()=>({sessions:saved?[{id:saved.id,prompt:saved.prompt,status:saved.status,createdAt:'2026-11-01'}]:[],total:saved?1:0,discoveredTotal:saved?1:0,unavailable:0,truncated:false,scanTruncated:false,page:1,pageSize:50,totalPages:1,q:'',hasPrevious:false,hasNext:false})};}
    if(url==='/api/sessions/saved-id'&&!options)return {ok:true,json:async()=>saved};
    requests.push({url,...JSON.parse(options?.body||'{}')});
    return {ok:!failedPost,json:async()=>failedPost?{error:'Invalid selection'}:{id:'synthetic-session'}};
  };
  const address=initialURL?new URL(initialURL):undefined;const urlWrites:string[]=[];
  const urlGlobals=address?{location:address,history:{replaceState(_state:unknown,_title:string,path:string){address.href=new URL(path,address).href;urlWrites.push(address.href);}}}:{};
  runInNewContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),{document:{getElementById:(id:string)=>elements[id],createElement:(tag:string)=>Object.assign(new Element(),{tagName:tag}),createTextNode:(text:string)=>Object.assign(new Element(),{textContent:text})},fetch,EventSource:FakeEvents,URLSearchParams,...urlGlobals});
  await new Promise(resolve=>setImmediate(resolve));
  const rows=elements.providerChoices.children.map(card=>({toggle:card.children[0].children[0],model:card.children[2]}));
  return {elements,rows,requests,streams,historyRequests,address,urlWrites};
}
test('UI hydrates defaults, requires two, disables deselected models and updates call bounds',async()=>{
 const {elements,rows,requests}=await setup();
 assert.equal(rows.length,3);assert.equal(rows[0].model.placeholder,'codex-default');assert.equal(rows[2].model.disabled,true);
 assert.equal(elements.run.disabled,false);assert.equal(elements.maxCalls.textContent,6);
 rows[1].toggle.checked=false;rows[1].toggle.onchange!();assert.equal(elements.run.disabled,true);assert.match(elements.selectionError.textContent,/at least two/);
 await elements.run.onclick!();assert.equal(requests.length,0);
 rows[2].toggle.checked=true;rows[2].toggle.onchange!();assert.equal(elements.run.disabled,false);assert.equal(rows[2].model.disabled,false);
 rows[2].model.value='--bad';rows[2].model.oninput!();assert.equal(elements.run.disabled,true);
});
test('UI sends only selected models, freezes running controls, handles completion and preserves user choices',async()=>{
 const {elements,rows,requests,streams}=await setup();rows[0].model.value=' chosen-model ';rows[2].model.value='ignored';
 await elements.run.onclick!();
 assert.deepEqual(requests[0].selection,{providers:['codex','claude'],models:{codex:'chosen-model',claude:''}});
 assert.equal(elements.run.disabled,true);assert.ok(rows.every(row=>row.toggle.disabled&&row.model.disabled));
 await elements.run.onclick!();assert.equal(requests.length,1);
 streams[0].onmessage!({data:JSON.stringify({type:'session.finished',status:'completed',spendKnownUSD:0.01,spendIncomplete:true})});
 assert.equal(elements.run.disabled,false);assert.match(elements.cost.textContent,/unknown costs/);assert.equal(streams[0].closed,true);
 rows[2].toggle.checked=true;rows[2].toggle.onchange!();assert.equal(elements.plannedCalls.textContent,9);assert.equal(elements.maxCalls.textContent,6);
 assert.equal(rows[0].model.value,' chosen-model ');assert.equal(elements.report.style.display,'inline');
});
test('UI fails closed on configuration failure and recovers controls after rejected request',async()=>{
 const failed=await setup(true);assert.equal(failed.elements.run.disabled,true);await failed.elements.run.onclick!();assert.equal(failed.requests.length,0);
 const rejected=await setup(false,true);await rejected.elements.run.onclick!();assert.equal(rejected.elements.run.disabled,false);assert.equal(rejected.streams.length,0);
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
 const {elements,rows,requests,streams}=await setup(false,false,saved,true);
 elements.savedSessions.value='saved-id';elements.savedSessions.onchange!();await elements.openSaved.onclick!();
 assert.equal(elements.run.disabled,true);await elements.run.onclick!();
 assert.equal(requests.length,0);assert.equal(streams.length,0);assert.equal(elements.status.textContent,'completed');assert.equal(elements.calls.textContent,9);assert.equal(elements.maxCalls.textContent,9);
 assert.equal(elements.feed.children.filter(e=>['codex','claude','grok'].some(id=>e.className==='message '+id)).length,9);
 assert.match(elements.outcome.textContent,/Aligned direction · proposals differ/);assert.match(elements.outcome.textContent,/Timing disputed/);assert.equal(rows[0].model.value,'saved-codex');assert.equal(elements.question.value,saved.prompt);
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
 assert.equal(rows.length,2);assert.equal(elements.run.disabled,true);assert.match(elements.selectionError.textContent,/different model IDs/);
 rows[0].model.value='model-a';rows[1].model.value='model-a';rows[1].model.oninput!();assert.equal(elements.run.disabled,true);
 rows[1].model.value='model-b';rows[1].model.oninput!();assert.equal(elements.run.disabled,false);assert.equal(elements.plannedCalls.textContent,6);
 await elements.run.onclick!();assert.deepEqual(requests[0].selection,{providers:['codex','codex-2'],models:{codex:'model-a','codex-2':'model-b'}});
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
