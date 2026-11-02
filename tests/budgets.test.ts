import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetPolicy,BudgetLedger,budgetMarkdown} from '../src/budgets.ts';
const strict=(maxCalls=9,maxTokens=100)=>new BudgetLedger(budgetPolicy({maxCalls,maxTokens},{}));
test('budget configuration is bounded, frozen and cannot relax server ceilings',()=>{
 assert.deepEqual(budgetPolicy(undefined,{}),{maxCalls:9,maxTokens:null});
 const p=budgetPolicy({maxCalls:4,maxTokens:30},{MAX_SESSION_CALLS:'5',MAX_SESSION_TOKENS:'50'});assert.ok(Object.isFrozen(p));
 for(const value of [null,[],{other:1},{maxCalls:10},{maxCalls:0},{maxCalls:'2'},{maxTokens:0},{maxTokens:Infinity},{maxTokens:1.2}])assert.throws(()=>budgetPolicy(value,{}));
 for(const value of [{maxCalls:6},{maxTokens:51},{maxTokens:null}])assert.throws(()=>budgetPolicy(value,{MAX_SESSION_CALLS:'5',MAX_SESSION_TOKENS:'50'}));
 for(const env of [{MAX_SESSION_CALLS:''},{MAX_SESSION_TOKENS:'bad'},{MAX_SESSION_CALLS:'-1'}])assert.throws(()=>budgetPolicy(undefined,env));
});
test('atomic reservations prevent delayed concurrent usage from oversubscribing tokens',()=>{
 const b=strict();const first=b.reserveRound([30,30]);assert.ok(first.tickets);assert.equal(b.snapshot().reservedTokens,60);
 assert.match(b.reserveRound([30,30]).reason!,/token budget/);assert.equal(b.snapshot().admittedCalls,2);
 b.settle(first.tickets[0],{inputTokens:10,outputTokens:5,cacheReadTokens:9,reasoningTokens:3});
 assert.equal(b.snapshot().chargedTokens,15);assert.equal(b.snapshot().reservedTokens,30);
 assert.ok(b.reserveRound([20,20]).tickets);assert.equal(b.snapshot().reservedTokens,70);
});
test('unsupported ceilings and insufficient call slots refuse the entire round',()=>{
 const b=strict(3);assert.match(b.reserveRound([undefined,10]).reason!,/no verified/);assert.equal(b.snapshot().admittedCalls,0);
 assert.ok(b.reserveRound([10,10]).tickets);assert.match(b.reserveRound([10,10]).reason!,/call budget/);assert.equal(b.snapshot().admittedCalls,2);
});
test('unknown usage consumes its reservation and cannot be settled twice',()=>{
 const b=strict(),r=b.reserveRound([40,40]);assert.ok(r.tickets);
 b.settle(r.tickets[0]);b.settle(r.tickets[1],{inputTokens:5});
 assert.equal(b.snapshot().chargedTokens,80);assert.equal(b.snapshot().unknownUsageCalls,2);assert.equal(b.snapshot().reservedTokens,0);
 assert.throws(()=>b.settle(r.tickets[0],{inputTokens:0,outputTokens:0}));assert.match(b.reserveRound([11,11]).reason!,/token budget/);
});
test('provider ceiling violations remain visible and stop further admissions',()=>{
 const b=strict(),r=b.reserveRound([20,20]);assert.ok(r.tickets);b.settle(r.tickets[0],{inputTokens:21,outputTokens:1});
 assert.equal(b.snapshot().breached,true);assert.match(b.reserveRound([1,1]).reason!,/exceeded/);assert.match(budgetMarkdown(b.snapshot()).join('\n'),/BREACH/);
});
test('call-only mode records known tokens without pretending to enforce token or USD ceilings',()=>{
 const b=new BudgetLedger(budgetPolicy({maxCalls:2},{})),r=b.reserveRound([undefined,undefined]);assert.ok(r.tickets);
 b.settle(r.tickets[0],{inputTokens:100,outputTokens:20});b.settle(r.tickets[1]);
 assert.equal(b.snapshot().chargedTokens,120);assert.equal(b.snapshot().unknownUsageCalls,1);assert.equal(b.snapshot().breached,false);
 assert.match(budgetMarkdown(b.snapshot()).join('\n'),/no hard token ceiling/);assert.match(budgetMarkdown(b.snapshot()).join('\n'),/advisory/);
});

test('partially known usage above the ceiling still detects a breach',()=>{
 const b=strict(),r=b.reserveRound([10,10]);assert.ok(r.tickets);b.settle(r.tickets[0],{inputTokens:15});assert.equal(b.snapshot().breached,true);assert.equal(b.snapshot().chargedTokens,15);assert.equal(b.snapshot().unknownUsageCalls,1);
});
test('invalid historical budget state is rejected and absent legacy state stays unknown',async()=>{
 const {validBudgetState}=await import('../src/budgets.ts');const state=strict().snapshot();assert.ok(validBudgetState(state));
 for(const value of [null,{}, {...state,policy:{maxCalls:9}}, {...state,chargedTokens:-1},{...state,admittedCalls:10},{...state,unknownUsageCalls:1}])assert.equal(validBudgetState(value),false);
 assert.match(budgetMarkdown().join('\n'),/not recorded/);
});


test('call-bounded reports label partial tokens as a lower bound and do not imply breach monitoring',()=>{
 const b=new BudgetLedger(budgetPolicy({maxCalls:2},{})),r=b.reserveRound([undefined,undefined]);assert.ok(r.tickets);
 b.settle(r.tickets[0],{inputTokens:100,outputTokens:20,cacheReadTokens:80,reasoningTokens:10});
 b.settle(r.tickets[1],{outputTokens:7,usd:null});
 const report=budgetMarkdown(b.snapshot()).join('\n');
 assert.equal(b.snapshot().chargedTokens,127);assert.equal(b.snapshot().unknownUsageCalls,1);
 assert.match(report,/Known input \+ output tokens: 127/);assert.match(report,/lower bound, not the discussion total/);
 assert.match(report,/Missing usage is unknown, not zero/);assert.match(report,/breach detection is not applicable/);
 assert.match(report,/remote work may continue/);assert.doesNotMatch(report,/No adapter ceiling breach recorded/);
});
test('complete reported counters are distinguished from complete backend accounting',()=>{
 const b=new BudgetLedger(budgetPolicy({maxCalls:2},{})),r=b.reserveRound([undefined,undefined]);assert.ok(r.tickets);
 for(const ticket of r.tickets)b.settle(ticket,{inputTokens:0,outputTokens:0,usd:null});
 const report=budgetMarkdown(b.snapshot()).join('\n');
 assert.match(report,/Known input \+ output tokens: 0/);assert.match(report,/No settled calls have missing/);
 assert.match(report,/do not prove coverage of hidden provider work/);assert.doesNotMatch(report,/Token accounting is incomplete/);
});
