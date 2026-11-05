import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeCatalog,providerModelCatalog,catalogCommand} from '../src/model-catalog.ts';
function fixture(t:test.TestContext,provider:string,mode='ok'){
 const root=mkdtempSync(join(tmpdir(),'synqo-catalog-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const script=join(root,'catalog.mjs'),trace=join(root,'trace.jsonl');
 writeFileSync(script,`import {appendFileSync} from 'node:fs';import {createInterface} from 'node:readline';
 const [trace,provider,mode]=process.argv.slice(2);const record=data=>appendFileSync(trace,JSON.stringify(data)+'\\n');
 record({cwd:process.cwd(),pid:process.pid,environment:Object.keys(process.env)});
 if(mode==='hang'){setInterval(()=>{},10000);}else if(mode==='large'){process.stdout.write('private-upstream-error'.repeat(60000));}else{
 createInterface({input:process.stdin}).on('line',line=>{const frame=JSON.parse(line);record({frame});
 if(provider==='codex'){
  if(!['initialize','initialized','model/list'].includes(frame.method))process.exit(9);
  if(frame.method==='initialize')console.log(JSON.stringify({id:1,result:{}}));
  if(frame.method==='model/list')console.log(JSON.stringify(mode==='error'?{id:2,error:{message:'private-upstream-error'}}:{id:2,result:{data:[{model:'model-a',displayName:'Model A'},{model:'model-b',displayName:'Model B'}],nextCursor:null}}));
 }else{
  if(frame.type!=='control_request'||frame.request?.subtype!=='initialize')process.exit(9);
  console.log(JSON.stringify({type:'control_response',response:{request_id:frame.request_id,subtype:'success',response:{models:[{value:'sonnet',resolvedModel:'claude-test-sonnet',displayName:'Sonnet'},{value:'opus',resolvedModel:'claude-test-opus',displayName:'Opus'}]}}}));
 }
 });}
 `);
 return {root,trace,command:{file:process.execPath,args:[script,trace,provider,mode]}};
}
test('catalog normalization uses provider-reported IDs, preserves order and excludes default/invalid entries',()=>{
 const catalog=normalizeCatalog('claude',[{value:'default',resolvedModel:'not-an-explicit-choice'},{value:'sonnet',resolvedModel:'claude-sonnet-test',displayName:'Sonnet'},{value:'sonnet',resolvedModel:'claude-sonnet-test'},{value:'bad model'},{value:'auto'},{value:'opus',displayName:'Opus'}]);
 assert.deepEqual(catalog.models,['claude-sonnet-test','opus']);assert.equal(catalog.omitted,3);assert.equal(catalog.availabilityVerified,false);assert.equal(catalog.inferencePerformed,false);
 const bounded=normalizeCatalog('codex',Array.from({length:205},(_,i)=>({model:'model-'+i})));assert.equal(bounded.models.length,200);assert.equal(bounded.total,205);assert.equal(bounded.truncated,true);
 const partial=normalizeCatalog('codex',[{model:'first'}],true);assert.equal(partial.total,null);assert.equal(partial.truncated,true);
});
for(const provider of ['codex','claude'] as const)test(`${provider} metadata protocol never sends a prompt and cleans up its isolated process/workspace`,async t=>{
 const f=fixture(t,provider);const before=process.env.BRAVE_SEARCH_API_KEY;process.env.BRAVE_SEARCH_API_KEY='synthetic-secret';t.after(()=>{if(before===undefined)delete process.env.BRAVE_SEARCH_API_KEY;else process.env.BRAVE_SEARCH_API_KEY=before;});
 const catalog=await providerModelCatalog(provider,{command:f.command});assert.equal(catalog.models.length,2);
 const trace=readFileSync(f.trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.ok(!trace[0].environment.includes('BRAVE_SEARCH_API_KEY'));assert.notEqual(trace[0].cwd,process.cwd());assert.equal(existsSync(trace[0].cwd),false);
 const frames=trace.slice(1).map(row=>row.frame);assert.deepEqual(provider==='codex'?frames.map(frame=>frame.method):frames.map(frame=>frame.request.subtype),provider==='codex'?['initialize','initialized','model/list']:['initialize']);
 assert.ok(frames.every(frame=>!('prompt' in frame)&&frame.type!=='user'&&!['thread/start','turn/start'].includes(frame.method)));
 assert.throws(()=>process.kill(trace[0].pid,0));
});
for(const mode of ['hang','large','error'])test(`catalog ${mode} fails closed with no upstream text or retry`,async t=>{
 const f=fixture(t,'codex',mode);await assert.rejects(providerModelCatalog('codex',{command:f.command,timeoutMs:3000}),error=>{assert.ok(error instanceof Error);assert.doesNotMatch(error.message,/private-upstream-error/);return true;});
 const trace=readFileSync(f.trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));assert.equal(trace.filter(row=>row.pid).length,1);assert.throws(()=>process.kill(trace[0].pid,0));
});
test('pinned catalog commands force account authentication and disable ambient tools/hooks',()=>{
 const codex=catalogCommand('codex'),claude=catalogCommand('claude');assert.ok(codex.args.includes('app-server'));assert.ok(codex.args.includes('forced_login_method="chatgpt"'));assert.ok(codex.args.includes('mcp_servers={}'));
 assert.ok(claude.args.includes('--no-session-persistence'));assert.ok(claude.args.includes('--strict-mcp-config'));assert.ok(claude.args.some(arg=>arg.includes('"forceLoginMethod":"claudeai"')&&arg.includes('"disableAllHooks":true')));
});
