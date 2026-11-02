import test from 'node:test';
import assert from 'node:assert/strict';
import type {Usage as CodexUsage} from '@openai/codex-sdk';
import {configuredProviders, subscriptionEnvironment} from '../src/provider-config.ts';
import {codexUsage} from '../src/codex-usage.ts';
import {createAdapters, CodexAdapter, ClaudeAdapter} from '../src/adapters.ts';

for (const roster of ['codex,claude', 'codex,grok', 'claude,grok', 'grok,claude,codex']) {
  test(`configures distinct subscription providers: ${roster}`, () => {
    const ids = configuredProviders(roster);
    assert.deepEqual(createAdapters('mock', ids).map(a => a.id), roster.split(','));
    assert.deepEqual(createAdapters('real', ids).map(a => a.id), roster.split(','));
  });
}
for (const roster of ['', 'codex', 'codex,codex', 'codex,gemini', 'codex,claude,', 'codex,claude,grok,codex']) {
  test(`rejects invalid roster before dispatch: ${roster}`, () => assert.throws(() => configuredProviders(roster), /at least two distinct/));
}
test('provider whitespace is normalized and unselected transports do not constrain a pair', t => {
  const old=process.env.GROK_TRANSPORT;
  t.after(()=>{if(old===undefined)delete process.env.GROK_TRANSPORT;else process.env.GROK_TRANSPORT=old;});
  process.env.GROK_TRANSPORT='api';
  assert.deepEqual(createAdapters('real', configuredProviders(' codex, claude ')).map(a=>a.id), ['codex','claude']);
  assert.throws(()=>createAdapters('real', ['codex','grok']), /API-key fallback is disabled/);
  assert.throws(()=>createAdapters('typo', ['codex','claude']), /MODE/);
});
test('subscription environment retains login locations, strips secrets and routing, and never mutates source', () => {
  const source={HOME:'/synthetic/home',PATH:'/synthetic/bin',CODEX_HOME:'/synthetic/codex',CLAUDE_CONFIG_DIR:'/synthetic/claude',
    OPENAI_API_KEY:'synthetic',CODEX_API_KEY:'synthetic',ANTHROPIC_API_KEY:'synthetic',ANTHROPIC_AUTH_TOKEN:'synthetic',
    CLAUDE_CODE_OAUTH_TOKEN:'synthetic',XAI_API_KEY:'synthetic',OPENAI_BASE_URL:'https://invalid.example',
    CLAUDE_CODE_USE_BEDROCK:'1',ANTHROPIC_BASE_URL:'https://invalid.example',NODE_OPTIONS:'--require=unexpected'};
  assert.deepEqual(subscriptionEnvironment(source), {HOME:source.HOME,PATH:source.PATH,CODEX_HOME:source.CODEX_HOME,CLAUDE_CONFIG_DIR:source.CLAUDE_CONFIG_DIR});
  assert.equal(source.ANTHROPIC_API_KEY,'synthetic');
});
test('Codex explicitly selects ChatGPT login without API credentials', async () => {
  const adapter=new CodexAdapter(async options=>{
    assert.deepEqual(options.config,{forced_login_method:'chatgpt',model_provider:'openai'});
    assert.equal(options.apiKey,undefined);
    assert.deepEqual(options.env,subscriptionEnvironment());
    return {startThread:()=>({id:'fake',async run(){return {items:[],finalResponse:'offline',usage:null};}})};
  });
  assert.equal((await adapter.run('synthetic',1,new AbortController().signal)).usage?.usd,null);
});
test('Claude explicitly selects Claude subscription login with a clean environment', async () => {
  const adapter=new ClaudeAdapter(async()=>({options})=>{
    assert.deepEqual(options.settings,{forceLoginMethod:'claudeai'});
    assert.deepEqual(options.env,subscriptionEnvironment());
    assert.deepEqual(options.settingSources,[]);
    return {async *[Symbol.asyncIterator](){},close(){}};
  });
  await assert.rejects(adapter.run('synthetic',1,new AbortController().signal),{code:'empty_response'});
});
test('Codex accounting accepts only documented counters; missing, invalid and unsolicited costs stay unknown', () => {
  const valid={input_tokens:100,cached_input_tokens:40,cache_write_input_tokens:10,output_tokens:25,reasoning_output_tokens:15};
  assert.deepEqual(codexUsage({...valid,usd:0,total_cost_usd:0.5} as CodexUsage),{inputTokens:100,outputTokens:25,cacheReadTokens:40,cacheWriteTokens:10,reasoningTokens:15,usd:null});
  for(const value of [null, {} as CodexUsage, {...valid,input_tokens:-1,output_tokens:NaN}]) {
    assert.equal(codexUsage(value).inputTokens,undefined);
    assert.equal(codexUsage(value).outputTokens,undefined);
    assert.equal(codexUsage(value).usd,null);
  }
  assert.equal(codexUsage({...valid,input_tokens:0}).inputTokens,0);
});

test('disabled providers constrain defaults without changing historical structural validation',t=>{
 const old=process.env.KOINOUS_DISABLED_PROVIDERS;process.env.KOINOUS_DISABLED_PROVIDERS='grok';
 t.after(()=>{if(old===undefined)delete process.env.KOINOUS_DISABLED_PROVIDERS;else process.env.KOINOUS_DISABLED_PROVIDERS=old;});
 assert.deepEqual(configuredProviders('codex,claude'),['codex','claude']);
 assert.throws(()=>configuredProviders('codex,grok'),/disabled/);
 process.env.KOINOUS_DISABLED_PROVIDERS='unknown';assert.throws(()=>configuredProviders('codex,claude'),/Invalid/);
});
