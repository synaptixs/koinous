import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../src/engine.ts';
import type {Adapter} from '../src/core.ts';
process.env.EVIDENCE_FILE=new URL('../examples/demo-evidence.json',import.meta.url).pathname;
delete process.env.MCP_SERVER_URL;
for(const mode of ['success','prepare-fail','call-fail','cleanup-fail','cancel'])test(`engine lifecycle ${mode}: prepare before every model, teardown before final report`,async t=>{
 const root=mkdtempSync(join(tmpdir(),'koinous-engine-lifecycle-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 let prepared=false,disposed=false,disposeCalls=0;let engine:Engine;
 const adapters:Adapter[]=['codex','claude','grok'].map(id=>({id:id as Adapter['id'],async run(){assert.ok(prepared);if(mode==='call-fail')throw Error('synthetic');return {text:'answer',usage:{usd:null}};},...(id==='grok'?{
 async prepare(){if(mode==='prepare-fail')throw Error('preflight failed');prepared=true;if(mode==='cancel')engine.cancel(session);},
 async dispose(){disposeCalls++;assert.equal(session.report,undefined);assert.equal(session.status,'cleaning');disposed=true;if(mode==='cleanup-fail')throw Error('cleanup failed');}
 }: {})}));
 engine=new Engine(()=>adapters,root);const session=engine.create('synthetic',3);await engine.run(session);
 assert.ok(disposed);assert.equal(disposeCalls,1);assert.equal(session.events.at(-1)?.type,'session.finished');
 if(['prepare-fail','cancel'].includes(mode))assert.equal(session.calls,0);
 if(mode==='success'){assert.equal(session.calls,9);assert.equal(session.status,'completed');assert.match(session.report!,/runtime.cleaned/);assert.match(session.report!,/Unknown cost/);}
 if(mode==='cleanup-fail'){assert.equal(session.status,'failed');assert.match(session.report!,/cleanup unverified/);}
});
