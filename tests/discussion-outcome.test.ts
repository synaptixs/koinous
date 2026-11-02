import test from 'node:test';
import assert from 'node:assert/strict';
import {assessDiscussion,parsePosition,outcomeMarkdown} from '../src/discussion-outcome.ts';
import type {Position} from '../src/discussion-outcome.ts';
import type {Session,AgentId} from '../src/core.ts';
const p=(overrides:Partial<Position>={}):Position=>({direction:'pilot',recommendation:'Run a small pilot.',rationale:'Test demand before committing.',risks:['Demand is uncertain.'],disagreements:[],claims:[],nextSteps:['Define success criteria.'],...overrides});
function session(positions:Array<[AgentId,Position|string]>,roster:AgentId[]=['codex','claude','grok']):Session{return {id:'offline',prompt:'An idea',status:'completed',maxRounds:3,participants:roster,entries:positions.map(([agent,position])=>({agent,round:3,text:typeof position==='string'?position:JSON.stringify(position)})),events:[],interventions:[],calls:9,spendKnownUSD:0,spendIncomplete:true,cancel:new AbortController()};}
test('full matching positions yield agreement, one recommendation, rationale and next steps',()=>{
 const o=assessDiscussion(session([['codex',p()],['claude',p()],['grok',p()]]));assert.equal(o.status,'agreement');assert.equal(o.recommendation,'Run a small pilot.');assert.equal(o.coverage.valid,3);assert.equal(o.unresolved.length,0);assert.equal(outcomeMarkdown(o).filter(x=>x==='## Final recommendation').length,1);
});
test('direction alignment is not agreement on different recommendation wording',()=>{
 const o=assessDiscussion(session([['codex',p()],['claude',p({recommendation:'Interview five customers first.'})]],['codex','claude']));
 assert.equal(o.status,'direction-alignment');assert.equal(o.proposalBy,'codex');assert.equal(o.unresolved.length,2);assert.match(o.caveat,/not inferred semantic consensus/);
});
test('majority keeps minority position and explicit dissent',()=>{
 const o=assessDiscussion(session([['codex',p()],['claude',p()],['grok',p({direction:'reject',recommendation:'Do not launch.',disagreements:['The cost is unacceptable.']})]]));
 assert.equal(o.status,'majority-direction');assert.deepEqual(o.supporters,['codex','claude']);assert.ok(o.unresolved.some(x=>x.agent==='grok'&&x.text.includes('unacceptable')));assert.ok(o.unresolved.some(x=>x.text.includes('Do not launch.')));
});
test('split and insufficient responses produce a procedural fallback instead of fabricated consensus',()=>{
 const split=assessDiscussion(session([['codex',p()],['claude',p({direction:'reject'})]],['codex','claude']));assert.equal(split.status,'split');assert.equal(split.proposalBy,null);assert.match(split.recommendation,/Defer commitment/);
 const missing=assessDiscussion(session([['codex',p()],['claude','not JSON']]));assert.equal(missing.status,'insufficient');assert.deepEqual(missing.invalid,['claude']);assert.deepEqual(missing.missing,['grok']);
});
test('two of three replies cannot be called unanimous and malformed outputs retain gaps',()=>{
 const o=assessDiscussion(session([['codex',p()],['claude',p()]]));assert.equal(o.status,'majority-direction');assert.equal(o.coverage.expected,3);assert.equal(o.unresolved.some(x=>x.agent==='grok'),true);
});
test('same wording with declared disagreement does not erase dissent',()=>{
 const o=assessDiscussion(session([['codex',p({disagreements:['Budget still unresolved.']})],['claude',p()]],['codex','claude']));assert.equal(o.status,'direction-alignment');assert.match(outcomeMarkdown(o).join('\n'),/Budget still unresolved/);
});
test('parsing rejects omitted fields, extra endorsement claims, invalid directions and excessive text',()=>{
 for(const value of [{...p(),direction:'whatever'},{...p(),risks:'none'},{...p(),allAgree:true},{...p(),recommendation:''},{...p(),nextSteps:[]}])assert.equal(parsePosition(JSON.stringify(value)),null);
 assert.ok(parsePosition('```json\n'+JSON.stringify(p())+'\n```'));assert.equal(parsePosition('prefix '+JSON.stringify(p())),null);
});
test('assessment ignores arrival order and cannot use earlier rounds as final endorsements',()=>{
 const s=session([['grok',p()],['claude',p()],['codex',p()]]);assert.equal(assessDiscussion(s).proposalBy,'codex');s.entries[0].round=2;assert.equal(assessDiscussion(s).status,'majority-direction');
});
test('model markup is escaped in recommendation summary',()=>{
 const o=assessDiscussion(session([['codex',p({recommendation:'<script>bad</script>'})],['claude',p({recommendation:'<script>bad</script>'})]],['codex','claude']));assert.doesNotMatch(outcomeMarkdown(o).join('\n'),/<script>/);
});

test('cleanup failure marks the result provisional even when all final positions match',()=>{
 const s=session([['codex',p()],['claude',p()]],['codex','claude']);s.status='failed';const o=assessDiscussion(s);assert.notEqual(o.status,'agreement');assert.ok(o.unresolved.some(x=>x.text.includes('provisional')));
});
test('duplicate final responses are invalid rather than extra votes',()=>{
 const s=session([['codex',p()],['codex',p()],['claude',p()]],['codex','claude']);const o=assessDiscussion(s);assert.equal(o.status,'insufficient');assert.deepEqual(o.invalid,['codex']);
});

test('matching recommendations cannot hide unsupported facts or assumptions',()=>{
 for(const kind of ['fact','assumption'] as const){
 const claim={id:'c1',kind,text:'Productivity will double.',evidenceIds:[],snapshotId:null};
 const o=assessDiscussion(session([['codex',p({claims:[claim]})],['claude',p({claims:[claim]})]],['codex','claude']));
 assert.equal(o.status,'direction-alignment');assert.equal(o.claimAssessment?.checks.length,2);assert.ok(o.unresolved.some(x=>x.text.includes('Productivity will double')));assert.match(outcomeMarkdown(o).join('\n'),/Claims and support checks/);
 }
});
test('legacy positions remain readable with unassessed claim coverage and no new agreement certification',()=>{
 const legacy=p();delete legacy.claims;
 const o=assessDiscussion(session([['codex',legacy],['claude',legacy]],['codex','claude']));assert.equal(o.coverage.valid,2);assert.equal(o.status,'direction-alignment');assert.deepEqual(o.claimAssessment?.unassessed,['codex','claude']);
});
test('different risks, rationale and next steps cannot disappear behind matching recommendation wording',()=>{
 for(const delta of [{risks:['Unacceptable safety risk.']},{rationale:'Do not assume demand.'},{nextSteps:['Resolve coverage before starting.']}]){
 const o=assessDiscussion(session([['codex',p()],['claude',p(delta)]],['codex','claude']));assert.equal(o.status,'direction-alignment');assert.match(o.unresolved.map(x=>x.text).join(' '),/differences remain unreviewed/);
 }
});
test('cached parsed position and duplicate roster cannot fabricate votes',()=>{
 const s=session([['codex','malformed'],['claude',p()]],['codex','codex','claude']);s.entries[0].position=p();const o=assessDiscussion(s);assert.equal(o.coverage.expected,2);assert.equal(o.coverage.valid,1);assert.equal(o.status,'insufficient');assert.deepEqual(o.invalid,['codex']);
});
test('invalid claim schema invalidates the position instead of silently dropping claims',()=>{
 assert.equal(parsePosition(JSON.stringify({...p(),claims:[{id:'fake'}]})),null);
});

test('different subsidiary proposals remain unresolved even when headline wording matches',()=>{
 const o=assessDiscussion(session([['codex',p({claims:[{id:'p1',kind:'proposal',text:'Pilot for a week',evidenceIds:[],snapshotId:null}]})],['claude',p({claims:[{id:'p1',kind:'proposal',text:'Pilot for a year',evidenceIds:[],snapshotId:null}]})]],['codex','claude']));
 assert.equal(o.status,'direction-alignment');assert.match(o.unresolved.map(x=>x.text).join(' '),/proposal differences/);
});
