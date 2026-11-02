import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/engine.ts';
import {AGENTS} from '../src/core.ts';
import type {Adapter} from '../src/core.ts';

// Isolate evidence from developer MCP configuration; these tests never call models.
delete process.env.MCP_SERVER_URL;
process.env.EVIDENCE_FILE = new URL('../examples/demo-evidence.json', import.meta.url).pathname;

function setup(t: test.TestContext, fail: (id: string, round: number) => boolean = () => false) {
  const output = mkdtempSync(join(tmpdir(), 'koinous-test-'));
  t.after(() => rmSync(output, {recursive: true, force: true}));
  const prompts: Array<{id: string; round: number; prompt: string}> = [];
  const createAdapters = (): Adapter[] => AGENTS.map(id => ({id, async run(prompt, round) {
    prompts.push({id, round, prompt});
    if (fail(id, round)) throw new Error('Synthetic provider failure');
    return {text: `${id} answer ${round}`, usage: {usd: 0}};
  }}));
  return {engine: new Engine(createAdapters, output), prompts, output};
}

test('three rounds preserve independence, exchange peers, and persist nine calls', async t => {
  const {engine, prompts, output} = setup(t);
  const session = engine.create('Review the synthetic design');
  await engine.run(session);
  assert.equal(session.status, 'completed');
  assert.equal(session.calls, 9);
  assert.equal(session.entries.length, 9);
  for (const p of prompts.filter(p => p.round === 1)) assert.doesNotMatch(p.prompt, /answer 1/);
  for (const p of prompts.filter(p => p.round === 2)) {
    for (const id of AGENTS.filter(id => id !== p.id)) assert.ok(p.prompt.includes(`${id} answer 1`));
  }
  const events = readFileSync(join(output, session.id, 'events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(e => e.seq), events.map((_, i) => i + 1));
  assert.equal(events.at(-1).type, 'session.finished');
  assert.equal(readFileSync(join(output, session.id, 'report.md'), 'utf8'), session.report);
});

test('one failed provider stops the discussion before subsequent rounds', async t => {
  const {engine} = setup(t, id => id === 'grok');
  const session = engine.create('Review');
  await engine.run(session);
  assert.equal(session.calls, 3);
  assert.equal(session.entries.length, 2);
  assert.equal(session.status, 'partial');
  assert.equal(session.events.filter(e => e.type === 'agent.error').length, 1);
  assert.match(session.report!, /2 of 9 planned/);
  assert.match(session.report!, /Selected provider failed/);
  assert.deepEqual(session.participants, AGENTS);
});

for (const maxRounds of [1, 3]) {
  test(`loss of quorum in final round ${maxRounds} produces a partial report`, async t => {
    const {engine} = setup(t, (id, round) => round === maxRounds && id !== 'claude');
    const session = engine.create('Review', maxRounds);
    await engine.run(session);
    assert.equal(session.status, 'partial');
    assert.match(session.report!, /partial/);
    assert.ok(session.events.some(e => e.type === 'discussion.stopped'));
  });
}

test('stateful providers are isolated across concurrent and subsequent sessions', async t => {
  const output = mkdtempSync(join(tmpdir(), 'koinous-isolation-'));
  t.after(() => rmSync(output, {recursive: true, force: true}));
  let created = 0;
  const engine = new Engine(() => {
    created++;
    return AGENTS.map(id => {
      let history = '';
      return {id, async run(prompt) {
        history += prompt.match(/PROBLEM:\n([^\n]+)/)![1] + '\n';
        await Promise.resolve();
        return {text: history, usage: {usd: 0}};
      }};
    });
  }, output);
  const first = engine.create('SESSION_ALPHA');
  const second = engine.create('SESSION_BETA');
  await Promise.all([engine.run(first), engine.run(second)]);
  const third = engine.create('SESSION_GAMMA');
  await engine.run(third);
  assert.equal(created, 3);
  for (const session of [first, second, third]) {
    assert.equal(session.entries.length, 9);
    for (const entry of session.entries) assert.equal(entry.text, `${session.prompt}\n`.repeat(entry.round));
  }
});

test('duplicate starts cannot spend extra calls or rewrite a finished report', async t => {
  const {engine} = setup(t);
  const session = engine.create('Review');
  const running = engine.run(session);
  await assert.rejects(engine.run(session), /only run once/);
  await running;
  const report = session.report;
  await assert.rejects(engine.run(session), /only run once/);
  assert.equal(session.calls, 9);
  assert.equal(session.report, report);
});

test('cancellation before start performs no provider calls', async t => {
  const {engine} = setup(t);
  const session = engine.create('Review');
  engine.cancel(session);
  await engine.run(session);
  assert.equal(session.status, 'cancelled');
  assert.equal(session.calls, 0);
});

test('interventions during a round enter only the next frozen prompts', async t => {
  const {engine, prompts} = setup(t);
  const session = engine.create('Review');
  engine.on(session.id, event => {
    if (event.type === 'agent.started' && event.round === 1 && event.agent === 'codex') {
      engine.intervene(session, 'UNIQUE_HUMAN_CORRECTION');
    }
  });
  await engine.run(session);
  for (const p of prompts.filter(p => p.round === 1)) assert.doesNotMatch(p.prompt, /UNIQUE_HUMAN_CORRECTION/);
  for (const p of prompts.filter(p => p.round === 2)) assert.match(p.prompt, /UNIQUE_HUMAN_CORRECTION/);
});

test('timed-out provider cannot block the discussion or append late answers', async t => {
  const old = process.env.GROK_TIMEOUT_MS;
  process.env.GROK_TIMEOUT_MS = '10';
  t.after(() => { if (old === undefined) delete process.env.GROK_TIMEOUT_MS; else process.env.GROK_TIMEOUT_MS = old; });
  const {output} = setup(t);
  let release!: (reply: {text: string}) => void;
  const engine = new Engine(() => AGENTS.map(id => ({id, async run() {
    if (id === 'grok') return new Promise<{text: string}>(resolve => {release = resolve;});
    return {text: 'Answer', usage: {inputTokens: 10, outputTokens: 5, usd: 0}};
  }})), output);
  const session = engine.create('Review', 1);
  await engine.run(session);
  assert.equal(session.status, 'partial');
  assert.equal(session.entries.length, 2);
  assert.equal(session.spendIncomplete, true);
  assert.ok(session.events.some(e => e.type === 'agent.error' && e.code === 'timeout' && typeof e.durationMs === 'number'));
  const report = session.report;
  release({text: 'LATE ANSWER'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.entries.length, 2);
  assert.equal(session.report, report);
  assert.match(session.report!, /inputTokens \| 20 \| 1/);
});

test('usage on failed provider results remains in persisted events and session spend', async t => {
  const {ProviderFailure} = await import('../src/provider-runtime.ts');
  const {output} = setup(t);
  const engine = new Engine(() => AGENTS.map(id => ({id, async run() {
    if (id === 'claude') throw new ProviderFailure('provider_error', 'Failed result', {usage: {inputTokens: 8, outputTokens: 2, usd: 0.25}});
    return {text: 'Answer', usage: {inputTokens: 10, outputTokens: 5, usd: 0}};
  }})), output);
  const session = engine.create('Review', 1);
  await engine.run(session);
  assert.equal(session.spendKnownUSD, 0.25);
  assert.equal(session.spendIncomplete, false);
  assert.match(session.report!, /inputTokens \| 28 \| 0/);
  const events = readFileSync(join(output, session.id, 'events.jsonl'), 'utf8');
  assert.match(events, /"usd":0.25/);
});

for (const roster of [['codex','claude'], ['codex','grok'], ['claude','grok']] as const) {
  test(`two-provider three-round discussion: ${roster.join(',')}`, async t => {
    const {output}=setup(t);
    const prompts: Array<{id:string;round:number;text:string}>=[];
    const engine=new Engine(()=>roster.map(id=>({id,async run(text,round){
      prompts.push({id,round,text});
      return {text:`${id} answer ${round}`,usage:{inputTokens:10,outputTokens:2,usd:id==='codex'?null:0.01}};
    }})),output);
    const session=engine.create('Synthetic shared inquiry',3);
    await engine.run(session);
    assert.equal(session.status,'completed');assert.equal(session.calls,6);assert.equal(session.entries.length,6);
    assert.deepEqual(session.participants,roster);
    assert.equal(session.events.find(e=>e.type==='participants.configured')?.maxCalls,6);
    for(const p of prompts){
      if(p.round===1)assert.doesNotMatch(p.text,/answer 1/);
      else assert.ok(p.text.includes(`${roster.find(id=>id!==p.id)} answer ${p.round-1}`));
      assert.doesNotMatch(p.text,/both peers|three-provider/);
    }
    const report=readFileSync(join(output,session.id,'report.md'),'utf8');
    assert.match(report,/6 of 6 planned/);
    assert.match(report,/not subscription invoices/);
    if(session.participants.includes('codex')){
      assert.match(report,/Codex cost: unknown/);assert.match(report,/\| codex \| 0 \| 3 \|/);
      assert.match(report,/Unknown cost:\*\* 3 call/);
      assert.equal(session.spendIncomplete,true);
    }
  });
}
test('invalid injected rosters fail before grounding or provider calls', async t => {
  const {output}=setup(t);
  for(const roster of [[],['codex'],['codex','codex']] as const){
    let invoked=false;
    const engine=new Engine(()=>roster.map(id=>({id,async run(){invoked=true;return {text:'unexpected'};}})),output);
    const session=engine.create('Synthetic');await engine.run(session);
    assert.equal(session.status,'failed');assert.equal(invoked,false);assert.equal(session.calls,0);
    assert.equal(session.evidence,undefined);
  }
});
