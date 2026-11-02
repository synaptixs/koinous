import test from 'node:test';
import assert from 'node:assert/strict';
import {readPublishedManifest,resolvePublishedEvidence,fetchPublishedEvidence,sha256,canonicalJSON} from '../src/published-pkg.ts';

import {fixture} from './helpers/published-fixture.ts';
test('published evidence resolves exact URI, lines, revision and text; hash is deterministic and facts frozen',()=>{
 const f=fixture();const a=resolvePublishedEvidence(f.approved,f.hash,f.search,f.provenance,'mcp');
 const b=resolvePublishedEvidence(f.approved,f.hash,JSON.parse(canonicalJSON(f.search)),JSON.parse(canonicalJSON(f.provenance)),'mcp');
 assert.deepEqual(a,b);assert.equal(a.items[0].provenance?.start_line,10);assert.equal(a.publication?.commitSha,'a'.repeat(40));
 assert.ok(Object.isFrozen(a.items[0].provenance));assert.throws(()=>{a.items[0].text='mutation';});
});
for(const mutation of ['hash','snapshot','unmerged','unreviewed','checks','unpublished','schema','duplicate-entity','traversal','uri','stale-index'])test(`rejects invalid trusted publication: ${mutation}`,()=>{
 const f=fixture();const m=f.manifest;
 if(mutation==='unmerged')m.publication.merged=false;
 if(mutation==='unreviewed')m.publication.reviewed=false;
 if(mutation==='checks')m.publication.checks_passed=false;
 if(mutation==='unpublished')m.publication.status='draft';
 if(mutation==='schema')m.schema_version=2;
 if(mutation==='duplicate-entity')m.entities.push(m.entities[0]);
 if(mutation==='traversal')m.entities[0].path='../outside';
 if(mutation==='uri')m.entities[0].uri='https://untrusted.invalid';
 if(mutation==='stale-index')m.indexes[0].commit_sha='b'.repeat(40);
 const raw=JSON.stringify(m);assert.throws(()=>readPublishedManifest(raw,mutation==='hash'?'0'.repeat(64):sha256(raw),mutation==='snapshot'?'wrong':m.snapshot_id));
});
for(const mutation of ['snapshot','commit','repository','bm25','vector','missing-index','unknown-entity','changed-text','duplicate-id','total','truncated','empty','provenance-revision','provenance-missing','provenance-duplicate','provenance-uri','provenance-lines','provenance-hash'])test(`rejects stale or unresolved retrieval: ${mutation}`,()=>{
 const f=fixture(),s=f.search,p=f.provenance;
 if(mutation==='snapshot')s.snapshot_id='old';if(mutation==='commit')s.commit_sha='b'.repeat(40);if(mutation==='repository')s.repository='other';
 if(mutation==='bm25')s.indexes[0].snapshot_id='old';if(mutation==='vector')s.indexes[1].commit_sha='b'.repeat(40);if(mutation==='missing-index')s.indexes.pop();
 if(mutation==='unknown-entity')s.results[0].entity_id='unknown';if(mutation==='changed-text')s.results[0].text+='edited';if(mutation==='duplicate-id')s.results.push(s.results[0]);
 if(mutation==='total')s.total=0;if(mutation==='truncated')s.total=2;if(mutation==='empty')s.results=[];
 if(mutation==='provenance-revision')p.commit_sha='b'.repeat(40);if(mutation==='provenance-missing')p.entities=[];if(mutation==='provenance-duplicate')p.entities.push(p.entities[0]);
 if(mutation==='provenance-uri')p.entities[0]={...p.entities[0],uri:'pkg://wrong'};
 if(mutation==='provenance-lines')p.entities[0]={...p.entities[0],start_line:11,uri:p.entities[0].uri.replace('L10-','L11-')};
 if(mutation==='provenance-hash')p.entities[0]={...p.entities[0],text_sha256:'0'.repeat(64)};
 assert.throws(()=>resolvePublishedEvidence(f.approved,f.hash,s,p,'mcp'));
});
test('coverage reports partial retrieval honestly without clipping selected text',()=>{
 const f=fixture();f.search.total=25;f.search.truncated=true;
 const e=resolvePublishedEvidence(f.approved,f.hash,f.search,f.provenance,'file');assert.equal(e.publication?.total,25);assert.equal(e.publication?.returned,1);assert.equal(e.items[0].text,f.search.results[0].text);
});
test('oversized complete evidence pack fails instead of truncating JSON or source text',()=>{
 const f=fixture();const text='x'.repeat(11000);f.search.results[0].text=text;f.manifest.entities[0].text_sha256=sha256(text);
 const second={...f.manifest.entities[0],entity_id:'other'};f.manifest.entities.push(second);f.provenance.entities.push(second);
 f.search.results.push({...f.search.results[0],entity_id:'other',evidence_id:'pkg:other'});f.search.total=2;
 const raw=JSON.stringify(f.manifest);assert.throws(()=>resolvePublishedEvidence(readPublishedManifest(raw,sha256(raw),'published-1'),sha256(raw),f.search,f.provenance,'file'),/prompt budget/);
});
test('MCP orchestration pins every request and allows only search and provenance methods',async()=>{
 const f=fixture(),calls:Array<{name:string;arguments:Record<string,unknown>}>=[];
 const client={async listTools(){return {tools:[{name:'search_pkg'},{name:'get_provenance'},{name:'mutate'}]};},async callTool(request:{name:string;arguments:Record<string,unknown>}){calls.push(request);return {structuredContent:request.name==='search_pkg'?f.search:f.provenance};}};
 const e=await fetchPublishedEvidence(client,f.approved,f.hash,'cache');assert.equal(e.items.length,1);
 assert.deepEqual(calls.map(c=>c.name),['search_pkg','get_provenance']);
 for(const c of calls){assert.equal(c.arguments.commit_sha,f.manifest.commit_sha);assert.equal(c.arguments.snapshot_id,'published-1');assert.equal(c.arguments.repository,'example');}
 assert.deepEqual(calls[1].arguments.entity_ids,['module:cache']);
});
test('stale search aborts before provenance request; cancellation and error envelopes fail closed',async()=>{
 const f=fixture();let calls=0;const client={async listTools(){return {tools:[{name:'search_pkg'},{name:'get_provenance'}]};},async callTool(){calls++;return {structuredContent:{...f.search,snapshot_id:'old'}};}};
 await assert.rejects(fetchPublishedEvidence(client,f.approved,f.hash,'q'));assert.equal(calls,1);
 await assert.rejects(fetchPublishedEvidence(client,f.approved,f.hash,'q',8,AbortSignal.abort()));assert.equal(calls,1);
 await assert.rejects(fetchPublishedEvidence({...client,async callTool(){return {isError:true,structuredContent:f.search};}},f.approved,f.hash,'q'));
});

test('repointing one snapshot label to a different approved revision changes canonical evidence hash',()=>{
 const a=fixture(),b=fixture();const old=resolvePublishedEvidence(a.approved,a.hash,a.search,a.provenance,'file');
 const newCommit='b'.repeat(40);b.manifest.commit_sha=newCommit;b.search.commit_sha=newCommit;b.provenance.commit_sha=newCommit;
 for(const idx of b.manifest.indexes)idx.commit_sha=newCommit;
 b.manifest.entities[0].uri=b.manifest.entities[0].uri.replace('a'.repeat(40),newCommit);
 const raw=JSON.stringify(b.manifest),hash=sha256(raw);const approved=readPublishedManifest(raw,hash,'published-1');
 const updated=resolvePublishedEvidence(approved,hash,b.search,b.provenance,'file');assert.notEqual(old.hash,updated.hash);
 assert.throws(()=>readPublishedManifest(raw,a.hash,'published-1'));
});
test('plain text JSON MCP envelopes are supported, but missing tools, malformed payload and over-return fail closed',async()=>{
 const f=fixture();const client={async listTools(){return {tools:[{name:'search_pkg'},{name:'get_provenance'}]};},async callTool(p:{name:string}){return {content:[{type:'text',text:JSON.stringify(p.name==='search_pkg'?f.search:f.provenance)}]};}};
 assert.equal((await fetchPublishedEvidence(client,f.approved,f.hash,'q')).items.length,1);
 await assert.rejects(fetchPublishedEvidence({...client,async listTools(){return {tools:[{name:'search_pkg'}]};}},f.approved,f.hash,'q'));
 for(const text of ['not-json','x'.repeat(100001)])await assert.rejects(fetchPublishedEvidence({...client,async callTool(){return {content:[{type:'text',text}]};}},f.approved,f.hash,'q'));
 await assert.rejects(fetchPublishedEvidence(client,f.approved,f.hash,'q',0));
});
