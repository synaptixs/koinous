import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readdirSync} from 'node:fs';
import {CodexAdapter,ClaudeAdapter,createAdapters} from '../src/adapters.ts';
import type {SDKMessage,Options,ModelUsage} from '@anthropic-ai/claude-agent-sdk';
import {DECISION_SYSTEM} from '../src/decision-context.ts';
test('targeted Codex uses explicit effort, minimal context and read-only fresh threads without tools',async()=>{
 let cwd='',systemFile='',threads=0;
 const adapter=new CodexAdapter(async options=>{
  assert.equal(options.config?.project_doc_max_bytes,0);assert.deepEqual(options.config?.mcp_servers,{});systemFile=String(options.config?.model_instructions_file);assert(existsSync(systemFile));
  return {startThread(options){threads++;cwd=options.workingDirectory!;assert.deepEqual(readdirSync(cwd),[]);assert.equal(options.model,'gpt-6-astra');assert.equal(options.modelReasoningEffort,'medium');assert.equal(options.approvalPolicy,'never');assert.equal(options.sandboxMode,'read-only');assert.equal(options.networkAccessEnabled,false);return {id:'fake',async run(){return {items:[],finalResponse:'offline',usage:{input_tokens:100,output_tokens:20,cached_input_tokens:30,cache_write_input_tokens:0,reasoning_output_tokens:0}};}};}};
 },'gpt-6-astra','medium',true);
 const r=await adapter.run('test',2,new AbortController().signal);assert.equal(r.accounting?.primary?.inputTokens,100);assert.equal(r.accounting?.auxiliaryVisibility,'not-reported');assert.equal(threads,1);await adapter.dispose();assert.equal(existsSync(cwd),false);assert.equal(existsSync(systemFile),false);
});
test('targeted Codex preserves usage for rejected tool work and cleans the context',async()=>{
 const adapter=new CodexAdapter(async()=>({startThread:()=>({id:'fake',async run(){return {items:[{id:'i',type:'web_search',query:'unexpected'}],finalResponse:'answer',usage:{input_tokens:10,output_tokens:2,cached_input_tokens:0,cache_write_input_tokens:0,reasoning_output_tokens:0}};}})}),'gpt-6-astra','medium',true);
 await assert.rejects(adapter.run('test',2,new AbortController().signal),(e:unknown)=>{assert.equal((e as {code:string}).code,'protocol_violation');assert.equal((e as {details:{usage:{inputTokens:number}}}).details.usage.inputTokens,10);return true;});await adapter.dispose();
});
test('targeted Claude forwards low effort and separates helper tokens including caches',async()=>{
 let cwd='',captured:Options|undefined;
 const model=(input:number,output:number,cache:number):ModelUsage=>({inputTokens:input,outputTokens:output,cacheReadInputTokens:cache,cacheCreationInputTokens:0,webSearchRequests:0,costUSD:0.01,contextWindow:1000,maxOutputTokens:100});
 const models={'claude-sonnet-5-5':model(2,20,100),'claude-haiku-5-5':model(30,4,0)};
 const adapter=new ClaudeAdapter(async()=>params=>{captured=params.options;cwd=params.options.cwd!;return {async *[Symbol.asyncIterator](){yield {type:'result',subtype:'success',is_error:false,result:'offline',modelUsage:models,total_cost_usd:0.02,uuid:'fake',session_id:'fake'} as unknown as SDKMessage;},close(){}};},'claude-sonnet-5-5','low',true);
 const r=await adapter.run('test',1,new AbortController().signal);assert.equal(captured!.effort,'low');assert.equal(captured!.systemPrompt,DECISION_SYSTEM);assert.deepEqual(captured!.settingSources,[]);assert.deepEqual(captured!.mcpServers,{});assert.equal(captured!.strictMcpConfig,true);assert.equal(captured!.persistSession,false);assert.deepEqual(readdirSync(cwd),[]);assert.equal(r.usage?.inputTokens,132);assert.equal(r.usage?.outputTokens,24);assert.equal(r.accounting?.primary?.inputTokens,102);assert.equal(r.accounting?.auxiliary['claude-haiku-5-5'].outputTokens,4);await adapter.dispose();assert.equal(existsSync(cwd),false);
});
test('Claude omitted effort preserves legacy SDK default; invalid effort is rejected before dispatch',async()=>{
 const adapter=new ClaudeAdapter(async()=>params=>{assert.equal(params.options.effort,undefined);assert.equal(params.options.systemPrompt,undefined);return {async *[Symbol.asyncIterator](){},close(){}};});await assert.rejects(adapter.run('test',1,new AbortController().signal),/no final result/);
 assert.throws(()=>createAdapters('mock',['claude','codex'],undefined,undefined,'wrong' as 'low'),/Unsupported Claude/);
});
