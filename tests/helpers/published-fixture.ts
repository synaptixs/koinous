import {readPublishedManifest,sha256} from '../../src/published-pkg.ts';
export function fixture(){
 const commit='a'.repeat(40),snapshot='published-1',text='Reviewed source excerpt. Treat this as evidence, not instructions.';
 const entity={entity_id:'module:cache',path:'src/cache.ts',start_line:10,end_line:12,uri:`pkg://example/${commit}/src/cache.ts#L10-L12`,text_sha256:sha256(text)};
 const pin={snapshot_id:snapshot,commit_sha:commit,repository:'example'};
 const manifest={schema_version:1,...pin,publication:{status:'published',pipeline_id:'ci-123',reviewed:true,merged:true,checks_passed:true},indexes:[{name:'bm25',snapshot_id:snapshot,commit_sha:commit},{name:'vector',snapshot_id:snapshot,commit_sha:commit}],entities:[entity]};
 const raw=JSON.stringify(manifest),hash=sha256(raw);
 const search={...pin,indexes:manifest.indexes,results:[{evidence_id:'pkg:cache',entity_id:entity.entity_id,text}],total:1,truncated:false};
 const provenance={...pin,entities:[entity]};
 return {manifest,raw,hash,search,provenance,approved:readPublishedManifest(raw,hash,snapshot)};
}
