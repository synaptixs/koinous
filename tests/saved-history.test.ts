import test from 'node:test';
import assert from 'node:assert/strict';
import {historyPage,historyQuery} from '../src/saved-history.ts';
import type {SavedSummary} from '../src/saved-sessions.ts';
const records:SavedSummary[]=Array.from({length:105},(_,i)=>({id:`id-${String(i).padStart(3,'0')}`,prompt:i===100?'Older café & support idea':'Regular idea',status:i===99?'failed':'completed',createdAt:new Date(Date.UTC(2026,0,1,0,0,105-i)).toISOString(),calls:9}));
test('paging reaches all 105 records without overlap and uses deterministic tie ordering',()=>{
 const pages=[1,2,3].map(page=>historyPage([...records].reverse(),{q:'',page,pageSize:50},0,false));
 assert.deepEqual(pages.map(p=>p.sessions.length),[50,50,5]);assert.deepEqual(pages.flatMap(p=>p.sessions.map(s=>s.id)),records.map(s=>s.id));
 assert.equal(pages[0].hasPrevious,false);assert.equal(pages[0].hasNext,true);assert.equal(pages[2].hasNext,false);assert.equal(pages[2].total,105);
 const tied=records.slice(0,3).map(s=>({...s,createdAt:records[0].createdAt})).reverse();assert.deepEqual(historyPage(tied,{q:'',page:1,pageSize:50},0,false).sessions.map(s=>s.id),['id-000','id-001','id-002']);
});
test('case-insensitive literal search applies before paging and supports idea, ID and status',()=>{
 for(const q of ['OLDER CAFÉ','id-100','cafe\u0301 & support'])assert.deepEqual(historyPage(records,{q,page:1,pageSize:50},0,false).sessions.map(s=>s.id),['id-100']);
 assert.equal(historyPage(records,{q:'failed',page:1,pageSize:50},0,false).total,1);
 assert.equal(historyPage(records,{q:'.*',page:1,pageSize:50},0,false).total,0);
 const empty=historyPage(records,{q:'not present',page:99,pageSize:50},2,true);assert.equal(empty.page,1);assert.equal(empty.totalPages,1);assert.equal(empty.discoveredTotal,105);assert.equal(empty.scanTruncated,true);assert.equal(empty.unavailable,2);assert.equal(empty.hasNext,false);
 assert.equal(historyPage(records,{q:'',page:100,pageSize:50},0,false).page,3);
});
test('query validates bounds and rejects malformed pagination instead of silently changing its meaning',()=>{
 assert.deepEqual(historyQuery(new URLSearchParams()),{q:'',page:1,pageSize:50});
 assert.deepEqual(historyQuery(new URLSearchParams('q=%20hello%20&page=2&pageSize=10')),{q:'hello',page:2,pageSize:10});
 for(const query of ['page=0','page=-1','page=1.5','page=NaN','page=','page=1000001','pageSize=51','pageSize=0','pageSize=2e1','q='+ 'a'.repeat(201)])assert.throws(()=>historyQuery(new URLSearchParams(query)));
});

test('provider and exact requested model filters match the same selection and combine with UTC dates/search',()=>{
 const data:SavedSummary[]=[
  {id:'a',prompt:'Pilot',status:'completed',calls:9,createdAt:'2026-11-01T00:00:00.000Z',providers:['codex','claude'],models:{codex:'gpt-test',claude:'claude-test'}},
  {id:'b',prompt:'Pilot',status:'completed',calls:9,createdAt:'2026-11-01T23:59:59.999Z',providers:['grok','claude'],models:{grok:'grok-test',claude:'gpt-test'}},
  {id:'c',prompt:'Pilot',status:'completed',calls:9,createdAt:'2026-11-02T00:00:00.000Z',providers:['codex'],models:{codex:'gpt-test'}},
  {id:'legacy',prompt:'Pilot',status:'completed',calls:0,createdAt:'2026-11-01T12:00:00.000Z'},
 ];
 const find=(params:string)=>historyPage(data,historyQuery(new URLSearchParams(params)),0,false).sessions.map(s=>s.id);
 assert.deepEqual(find('provider=codex&model=gpt-test&from=2026-11-01&to=2026-11-01&q=pilot'),['a']);
 assert.deepEqual(find('model=gpt-test&to=2026-11-01'),['b','a']);
 assert.deepEqual(find('provider=grok&model=gpt-test'),[]);
 assert.deepEqual(find('model=GPT-TEST'),[]);
 assert.deepEqual(find('from=2026-11-01&to=2026-11-01'),['b','legacy','a']);
 assert.equal(find('').length,4);assert.equal(find('provider=codex').length,2);
 const filtered=historyPage([...data,...data.map(s=>({...s,id:s.id+'2'}))],historyQuery(new URLSearchParams('provider=codex&pageSize=1&page=3')),0,false);assert.equal(filtered.total,4);assert.equal(filtered.sessions.length,1);assert.equal(filtered.filters.provider,'codex');
});
test('filter parameters reject invalid dates, reversed ranges, unsupported providers and invalid model IDs',()=>{
 for(const q of ['from=2026-02-30','to=2025-02-29','from=2026-1-01','from=invalid','from=2026-11-02&to=2026-11-01','provider=gemini','model=bad%20model','model='+ 'a'.repeat(129)])assert.throws(()=>historyQuery(new URLSearchParams(q)),q);
 assert.equal(historyQuery(new URLSearchParams('from=2024-02-29&to=2024-02-29')).from,'2024-02-29');
});
