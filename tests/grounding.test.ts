import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './helpers/published-fixture.ts';
import {getEvidence} from '../src/grounding.ts';
import {Engine} from '../src/engine.ts';
import {composePrompt} from '../src/core.ts';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {fetchPublishedEvidence} from '../src/published-pkg.ts';
function configured(t:test.TestContext){
 const root=mkdtempSync(join(tmpdir(),'koinous-pkg-'));const f=fixture();const old={...process.env};
 const keys=['MCP_SERVER_URL','MCP_SNAPSHOT_ID','PKG_MANIFEST_FILE','PKG_MANIFEST_SHA256','EVIDENCE_FILE','MCP_READ_TOOL','MCP_TOOL_ARGS_JSON'];
 for(const k of keys)delete process.env[k];
 Object.assign(process.env,{MCP_SNAPSHOT_ID:'published-1',PKG_MANIFEST_FILE:join(root,'manifest.json'),PKG_MANIFEST_SHA256:f.hash,EVIDENCE_FILE:join(root,'bundle.json')});
 writeFileSync(process.env.PKG_MANIFEST_FILE!,f.raw);
 const save=()=>writeFileSync(process.env.EVIDENCE_FILE!,JSON.stringify({search:f.search,provenance:f.provenance}));save();
 t.after(()=>{for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];rmSync(root,{recursive:true,force:true});});
 return {root,f,save};
}
test('offline published snapshot resolves provenance through real loader and all rounds retain identical evidence',async t=>{
 const {root,f,save}=configured(t);f.search.total=9;f.search.truncated=true;save();
 const prompts:string[]=[];const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as 'codex'|'claude',async run(prompt){prompts.push(prompt);return {text:'offline answer [pkg:cache]',usage:{usd:null}};}})),root);
 const session=engine.create('Synthetic query',3,undefined,{grounding:'configured'});await engine.run(session);
 assert.equal(session.status,'completed');assert.equal(session.calls,6);
 for(const p of prompts){assert.match(p,/Retrieval coverage: 1 of 9/);assert.ok(p.includes(f.search.results[0].text));assert.ok(p.includes(f.provenance.entities[0].uri));}
 assert.match(session.report!,/Retrieval coverage: 1 of 9 matches \(partial retrieval\)/);
 assert.match(session.report!,/lines 10–12/);assert.ok(session.report!.includes(f.search.results[0].text));
 assert.equal(readFileSync(join(root,session.id,'report.md'),'utf8'),session.report);
 assert.equal(session.events.find(e=>e.type==='grounding.pinned')?.publication!==null,true);
 assert.ok(composePrompt(session,'codex',1,'').includes('UNTRUSTED DATA'));
});
test('stale revision stops before runtime preparation and any provider dispatch',async t=>{
 const {root,f,save}=configured(t);f.search.indexes[1].snapshot_id='stale';save();let prepared=0,called=0;
 const engine=new Engine(()=>['codex','claude'].map(id=>({id:id as 'codex'|'claude',async prepare(){prepared++;},async run(){called++;return {text:'must not run'};}})),root);
 const session=engine.create('Synthetic query',3,undefined,{grounding:'configured'});await engine.run(session);
 assert.equal(session.status,'failed');assert.equal(session.calls,0);assert.equal(prepared,0);assert.equal(called,0);assert.match(session.report!,/Published PKG validation failed/);
});
test('missing trust pin and changed manifest fail closed; abort reads honor cancellation',async t=>{
 configured(t);delete process.env.PKG_MANIFEST_SHA256;await assert.rejects(getEvidence(),/no unverified fallback/);
 process.env.PKG_MANIFEST_SHA256='0'.repeat(64);await assert.rejects(getEvidence());
 await assert.rejects(getEvidence('q',AbortSignal.abort()));
});
test('synthetic snapshots remain explicitly unverified; MCP cannot use the legacy label-only path',async t=>{
 const {root}=configured(t);for(const k of ['PKG_MANIFEST_FILE','PKG_MANIFEST_SHA256','MCP_SNAPSHOT_ID'])delete process.env[k];
 writeFileSync(process.env.EVIDENCE_FILE!,JSON.stringify({snapshotId:'just-a-label',items:[{id:'x',uri:'synthetic://x',text:'fixture'}]}));
 const evidence=await getEvidence();assert.equal(evidence.publication,undefined);
 process.env.MCP_SERVER_URL='https://unused.invalid/mcp';await assert.rejects(getEvidence('q'),/no unverified fallback/);
 assert.ok(root);
});
test('published retrieval works over pinned SDK in-memory MCP transport without network or models',async()=>{
 const f=fixture(),calls:string[]=[];const server=new Server({name:'offline-pkg',version:'1'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:['search_pkg','get_provenance'].map(name=>({name,inputSchema:{type:'object' as const}}))}));
 server.setRequestHandler(CallToolRequestSchema,async request=>{calls.push(request.params.name);assert.equal(request.params.arguments?.snapshot_id,'published-1');return {content:[],structuredContent:request.params.name==='search_pkg'?f.search:f.provenance};});
 const client=new Client({name:'offline-test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
 try{await server.connect(b);await client.connect(a);const e=await fetchPublishedEvidence(client,f.approved,f.hash,'query');assert.equal(e.items[0].id,'pkg:cache');assert.deepEqual(calls,['search_pkg','get_provenance']);}
 finally{await client.close();await server.close();}
});

test('MCP configuration rejects mutation tools and revision override arguments before network use',async t=>{
 configured(t);process.env.MCP_SERVER_URL='https://unused.invalid/mcp';process.env.MCP_READ_TOOL='write_pkg';
 await assert.rejects(getEvidence('q'),/only permits/);process.env.MCP_READ_TOOL='search_pkg';
 process.env.MCP_TOOL_ARGS_JSON=JSON.stringify({snapshot_id:'untrusted-override'});await assert.rejects(getEvidence('q'),/cannot be overridden/);
 process.env.MCP_TOOL_ARGS_JSON='{}';process.env.MCP_SERVER_URL='http://remote.invalid/mcp';await assert.rejects(getEvidence('q'),/HTTPS/);
});
