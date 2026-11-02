import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {WorkerProfiles} from '../src/worker-profiles.ts';import {sdkBundle,executionSandbox,executionEnvironment} from '../src/sdk-execution.ts';import {confinedProcess} from '../src/confined-process.ts';import {ProviderFailure} from '../src/provider-runtime.ts';
async function exercise(t:test.TestContext,provider:'codex'|'claude',scenario:string){
 const root=realpathSync(mkdtempSync(join(tmpdir(),'koinous-wire-')));t.after(()=>rmSync(root,{recursive:true,force:true}));const owner={tenant:'synthetic',subject:'fixture'},p=new WorkerProfiles(root,[{...owner,provider}],[owner]).resolve(owner,provider)!;
 const trace=join(p.tmp,'wire.jsonl'),cli=join(root,'synthetic-cli.mjs'),script=join(root,'worker.mjs');
 writeFileSync(cli,`#!${realpathSync(process.execPath)}\nconst fixture=${JSON.stringify({provider,scenario,trace})};\n`+readFileSync(resolve('tests/fixtures/sdk-cli.mjs'),'utf8'),{mode:0o700});
 const bundle={...sdkBundle(provider),cli,script};
 writeFileSync(script,`
import {installConfinedSpawn} from ${JSON.stringify('file://'+resolve('src/confined-spawn.ts'))};
import {executionAdapter} from ${JSON.stringify('file://'+resolve('src/sdk-adapter.ts'))};
import {workerFailure} from ${JSON.stringify('file://'+resolve('src/worker-failure.ts'))};
installConfinedSpawn();const profile=${JSON.stringify(p)},bundle=${JSON.stringify(bundle)};
const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),${scenario==='hang'?800:1800});
try{const adapter=executionAdapter(profile,bundle,'synthetic-model',Object.fromEntries(Object.entries(process.env).filter(([,v])=>v!==undefined)));const replies=[];for(let round=1;round<=${scenario==='repeat'?3:1};round++)replies.push(await adapter.run('Synthetic protocol question',round,controller.signal));console.log(JSON.stringify({ok:true,reply:replies[0],replies}));}
catch(e){console.log(JSON.stringify(workerFailure(e)));}finally{clearTimeout(timer);}
`);
 const s=executionSandbox(p,bundle);const worker=confinedProcess(s.command,[...s.args,script],executionEnvironment(p),p.workspace,'',new AbortController().signal,3000);
 let output:any;if(scenario==='hang'){await assert.rejects(worker.done,e=>e instanceof ProviderFailure&&e.code==='timeout'&&e.details.usage?.usd===null);output={supervisorStopped:true};}else output=JSON.parse(await worker.done);const events=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));if(scenario==='hang'){const pid=events[0].pid;const status=spawnSync('/bin/ps',['-o','stat=','-p',String(pid)],{encoding:'utf8'}).stdout.trim();assert.ok(!status||status.startsWith('Z'),'hung synthetic CLI must not survive supervisor cleanup');}return {output,events,p};
}
for(const provider of ['codex','claude'] as const){
 test(`${provider}: pinned SDK exchanges real CLI protocol and normalizes usage offline`,async t=>{
  const {output,events,p}=await exercise(t,provider,'success');assert.equal(output.ok,true,JSON.stringify(output));assert.equal(output.reply.text,'Synthetic answer');assert.equal(output.reply.usage.outputTokens,5);assert.equal(output.reply.usage.cacheReadTokens,7);assert.equal(output.reply.usage.inputTokens,provider==='codex'?20:30);assert.equal(output.reply.usage.usd,provider==='codex'?null:0.012);
  const launch=events[0];assert.deepEqual(launch.apiKeys,[]);assert.equal(launch.inference,'0');assert.equal(launch.home,p.home);
  if(provider==='codex'){assert.ok(launch.args.includes('exec'));assert.ok(launch.args.some((s:string)=>s.includes('forced_login_method')));assert.equal(events.find(e=>e.type==='prompt').prompt,'Synthetic protocol question');}
  else{assert.ok(launch.args.includes('--output-format'));assert.ok(launch.args.includes('--input-format'));assert.ok(launch.args.includes('--settings'));assert.ok(launch.args.some((s:string)=>s.includes('claudeai')));assert.ok(events.some(e=>e.message?.request?.subtype==='initialize'));assert.ok(events.some(e=>e.message?.type==='user'));}
 });
 for(const scenario of ['failure','empty','missing_usage','malformed','exit','hang',...(provider==='codex'?['null_usage']:[])])test(`${provider}: ${scenario} protocol outcome`,async t=>{const {output}=await exercise(t,provider,scenario);if(scenario==='hang'){assert.equal(output.supervisorStopped,true);}else if(scenario==='missing_usage'){assert.equal(output.ok,true);assert.equal(output.reply.usage.usd,null);assert.equal(output.reply.usage.inputTokens,undefined);}else{assert.equal(output.ok,false,JSON.stringify(output));assert.ok(!JSON.stringify(output).includes('SYNTHETIC_PRIVATE_DIAGNOSTIC'));assert.ok(output.usage.usd===null||output.usage.usd===0.012);if(scenario==='empty'||provider==='claude'&&scenario==='failure'){assert.equal(output.usage.outputTokens,5);assert.equal(output.usage.inputTokens,provider==='claude'?30:20);assert.equal(output.usage.usd,provider==='claude'?0.012:null);}if(provider==='codex'&&scenario==='failure')assert.equal(output.usage.inputTokens,undefined);}});
}

for(const provider of ['codex','claude'] as const)test(`${provider}: three sequential calls preserve protocol and per-call usage`,async t=>{
 const {output,events}=await exercise(t,provider,'repeat');assert.equal(output.ok,true,JSON.stringify(output));assert.equal(output.replies.length,3);assert.ok(output.replies.every((r:any)=>r.usage.outputTokens===5));
 const launches=events.filter(e=>e.type==='launch');assert.equal(launches.length,3);
 if(provider==='codex'){assert.equal(launches[0].args.includes('resume'),false);for(const launch of launches.slice(1)){assert.ok(launch.args.includes('resume'));assert.ok(launch.args.includes('synthetic-thread'));}}
 else assert.equal(events.filter(e=>e.message?.request?.subtype==='initialize').length,3);
});

for(const provider of ['codex','claude'] as const)test(`${provider}: partial assistant output without terminal result cannot succeed`,async t=>{
 const {output}=await exercise(t,provider,'partial');assert.equal(output.ok,false);assert.ok(['incomplete_response','provider_error'].includes(output.code));assert.equal(output.usage.usd,null);assert.equal(output.reply,undefined);assert.ok(!JSON.stringify(output).includes('PARTIAL_ONLY'));
});
for(const scenario of ['partial_failure','duplicate','late_exit'])test(`codex: ${scenario} rejects output and preserves only terminal usage`,async t=>{
 const {output}=await exercise(t,'codex',scenario);assert.equal(output.ok,false);assert.equal(output.reply,undefined);assert.equal(output.usage.usd,null);assert.equal(output.usage.outputTokens,scenario==='partial_failure'?undefined:5);
});
