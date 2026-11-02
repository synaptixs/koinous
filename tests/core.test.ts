import test from 'node:test';
import assert from 'node:assert/strict';
import {composePrompt,makeReport,boundedInt} from '../src/core.ts';
import type {Session} from '../src/core.ts';
const s={id:'test',prompt:'Should we cache?',status:'completed',maxRounds:3,events:[],entries:[{round:1,agent:'claude',text:'Claude private answer'},{round:1,agent:'grok',text:'Grok private answer'},{round:1,agent:'codex',text:'Codex private answer'}],interventions:[],calls:3,spendKnownUSD:0,spendIncomplete:false,cancel:new AbortController(),evidence:{snapshotId:'published-v1',hash:'abc',source:'file',items:[{id:'abc-1',uri:'local://1',text:'Untrusted material'}]}} as Session;
test('round 1 independent (does not leak peer outputs)',()=>{const p=composePrompt(s,'codex',1,'');assert.doesNotMatch(p,/Claude private answer|Grok private answer/);assert.match(p,/published-v1/);});
test('round 2 includes peers but not own last reply as peer',()=>{const p=composePrompt(s,'codex',2,'');assert.match(p,/Claude private answer/);assert.match(p,/Grok private answer/);assert.match(p,/YOUR PRIOR POSITION:/);});
test('round count bound',()=>{assert.equal(boundedInt(9,3,1,3),3);assert.equal(boundedInt(2,3,1,3),2);});
test('report includes evidence provenance and caveat',()=>{assert.match(makeReport(s),/published-v1/);assert.match(makeReport(s),/not\*\* validated consensus/);});

test('report makes provider failure and later exclusions explicit despite completed lifecycle', () => {
 const degraded: Session = {...s,participants:['codex','claude','grok'],entries:[],events:[],calls:7};
 for(const round of [1,2,3] as const) {
  degraded.events.push({seq:round,at:'test',type:'round.started',round,agents:round===1?['codex','claude','grok']:['codex','claude']});
  for(const agent of ['codex','claude'] as const)degraded.entries.push({round,agent,text:`${agent} R${round}`});
 }
 degraded.events.push({seq:4,at:'test',type:'agent.error',round:1,agent:'grok',code:'incomplete_response',error:'Grok response did not complete',usage:{inputTokens:10,outputTokens:20,usd:0.01}});
 const report=makeReport(degraded);
 assert.match(report,/6 of 9 planned/);
 assert.match(report,/Incomplete participation/);
 assert.match(report,/\| grok \| Failed: incomplete_response \| Excluded after round 1 failure \| Excluded after round 1 failure \| 0 \/ 3 \|/);
 assert.match(report,/Grok response did not complete/);
 assert.match(report,/\| usd \| 0.01 \| 0 \|/);
});

test('report shows full coverage using the configured roster', () => {
 const full:Session={...s,participants:['codex','claude','grok'],entries:[]};
 for(const round of [1,2,3] as const)for(const agent of full.participants!)full.entries.push({round,agent,text:'Answer'});
 assert.match(makeReport(full),/9 of 9 planned.*Full participation/);
 assert.match(makeReport(full),/None recorded/);
 assert.match(makeReport({...full,participants:['codex'],entries:full.entries.filter(e=>e.agent==='codex')}),/3 of 3 planned/);
});

test('report distinguishes cancellation, budget denial, and rounds never reached', () => {
 const stopped:Session={...s,status:'cancelled',participants:['codex','claude','grok'],entries:[],events:[
  {seq:1,at:'test',type:'round.started',round:1,agents:['codex','claude','grok']},
  {seq:2,at:'test',type:'budget.denied',round:1,agent:'grok',reason:'Known-cost threshold reached'},
  {seq:3,at:'test',type:'session.error',error:'Cancelled'}]};
 const report=makeReport(stopped);
 assert.match(report,/0 of 9 planned/);
 assert.match(report,/Blocked: Known-cost threshold reached/);
 assert.match(report,/Not reached \(cancelled\)/);
 assert.match(report,/session.error \| Cancelled/);
});

test('report supports historical event rosters and does not invent missing rosters', () => {
 assert.match(makeReport({...s,events:[{seq:1,at:'test',type:'round.started',round:1,agents:['codex','claude','grok']}]}),/3 of 9 planned/);
 assert.match(makeReport(s),/roster unavailable/);
});

test('failure text cannot inject report table rows or HTML', () => {
 const report=makeReport({...s,events:[{seq:1,at:'test',type:'agent.error',round:1,agent:'grok',code:'failure',error:'bad|cell\n<script>alert(1)</script>'}]});
 assert.ok(report.includes('bad\\|cell &lt;script&gt;'));
 assert.doesNotMatch(report,/<script>/);
});

test('mock zero costs do not acquire an unknown subscription-cost label', () => {
 const report=makeReport({...s,events:[{seq:1,at:'test',type:'agent.completed',agent:'codex',usage:{usd:0,costSource:'mock'}}]});
 assert.doesNotMatch(report,/Codex cost: unknown/);
 assert.match(report,/\| codex \| 0 \| 0 \|/);
});

test('report renders peer reviews and revisions with numbered actions and unchanged originals',()=>{
 const review={reviews:[{peer:'claude',decision:'unresolved',reason:'Need a baseline.'}],revisedView:'Start with lexical.',openQuestions:['What latency budget?']};
 const position={direction:'pilot',recommendation:'Run a pilot.',rationale:'Measure first.',risks:['Recall gap'],disagreements:['Ranking is unresolved'],nextSteps:['Define metrics','Compare retrieval'],revisions:[{peer:'claude',decision:'adopted',reason:'Added baseline.'}]};
 const entries:Session['entries']=[{agent:'codex',round:1,text:'# Analysis\n\n- Compare approaches'}, {agent:'codex',round:2,text:JSON.stringify(review)}, {agent:'codex',round:3,text:JSON.stringify(position)}];
 const report=makeReport({...s,entries});
 for(const text of ['#### Revised view','#### Peer assessments','**claude — unresolved:** Need a baseline.','#### Open questions','#### Why this approach','**claude — adopted:** Added baseline.','1. Define metrics\n2. Compare retrieval'])assert.ok(report.includes(text),text);
 for(const entry of entries)assert.ok(report.includes(entry.text));
 assert.equal((report.match(/#### Original response/g)||[]).length,3);
});

test('invalid and overlength responses remain explicit and cannot break original-response fences',()=>{
 const text='```\n<script>bad</script>\n````';
 const report=makeReport({...s,entries:[{agent:'claude',round:2,text}]});
 assert.match(report,/Invalid — excluded from structured coverage/);
 assert.ok(report.includes('`````text\n'+text+'\n`````'));
 const overlong=JSON.stringify({reviews:[],revisedView:'x'.repeat(1201),openQuestions:[]});
 const invalid=makeReport({...s,entries:[{agent:'claude',round:2,text:overlong}]});
 assert.ok(invalid.includes(overlong));assert.match(invalid,/revisedView/);assert.match(invalid,/#### Revised view/);assert.match(invalid,/Length warning — usable/);assert.doesNotMatch(invalid,/No structured response warnings or errors recorded/);
});
