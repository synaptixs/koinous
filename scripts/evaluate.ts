import {readFileSync,writeFileSync,mkdirSync,existsSync,appendFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createAdapters,codexReasoningEffort} from '../src/adapters.ts';
import type {Adapter} from '../src/core.ts';
import {ARMS,CALLS,hash,validateTasks,evaluationSelection,executeCell,blindPackets,dashboardHtml,observability,gradeReport} from '../src/evaluation.ts';
import type {EvaluationResult,Factory} from '../src/evaluation.ts';
const repo=fileURLToPath(new URL('..',import.meta.url));
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const [command,configPath,output,authorizationPath]=process.argv.slice(2);
if(!['preflight','mock','live','grade'].includes(command)||!configPath||!output)throw Error('Usage: evaluate.ts preflight|mock|live config.json NEW-output-dir [authorization.json], or grade run-dir grades.json');
if(command==='grade'){
 const manifest=json(join(configPath,'manifest.json'));
 const report=gradeReport(json(join(configPath,'review','packets.json')),json(output),json(join(configPath,'private-key.json')),manifest.synthetic,manifest.taskIds);
 const result={...report,comparisonValid:!existsSync(join(configPath,'fatal.json')),runCoverage:json(join(configPath,'metrics.json'))};
 writeFileSync(join(configPath,'grades-report.json'),JSON.stringify(result,null,2),{flag:'wx'});
 console.log(JSON.stringify(report,null,2));
}else{
 const config=json(configPath);
 if(Object.keys(config).some(k=>!['selection','split','codexReasoningEffort'].includes(k))||!['development','heldout'].includes(config.split))throw Error('Config requires selection and development or heldout split');
 const reasoningEffort=codexReasoningEffort(config.codexReasoningEffort);
 const selection=evaluationSelection(config.selection),allTasks=validateTasks(json(join(repo,'evaluation/tasks.json'))),tasks=allTasks.filter(t=>t.split===config.split);
 const tracked=git('ls-files','-z').split('\0').filter(Boolean);
 const relevant=tracked.filter(p=>/^(src\/|scripts\/|evaluation\/|package(-lock)?\.json|tsconfig\.json)/.test(p));
 // Include new evaluation sources during offline development; live additionally requires clean Git.
 for(const p of ['src/evaluation.ts','scripts/evaluate.ts','evaluation/tasks.json','evaluation/PROTOCOL.md','evaluation/rubric-anchors.json'])if(!relevant.includes(p))relevant.push(p);
 const sourceHashes=Object.fromEntries(relevant.sort().map(p=>[p,hash(readFileSync(join(repo,p),'utf8'))]));
 const pkg=json(join(repo,'package.json'));
 const versions=Object.fromEntries(Object.entries({...pkg.dependencies,...pkg.devDependencies}).map(([name,expected])=>{const actual=json(join(repo,'node_modules',name,'package.json')).version;if(actual!==expected)throw Error(`Dependency mismatch: ${name}`);return [name,actual];}));
 const dirty=git('status','--porcelain').length>0;
 const spec={protocol:'koinous-p6-v2',revision:git('rev-parse','HEAD'),dirty,sourceHashes,lockHash:hash(readFileSync(join(repo,'package-lock.json'),'utf8')),datasetHash:hash(JSON.stringify(allTasks)),selection,split:config.split,taskIds:tasks.map(t=>t.id),arms:ARMS,maxCalls:tasks.length*16,settings:{timeoutMs:120000,maxRounds:3,retries:0,research:false,tools:false,wordTarget:450,reasoning:{codex:reasoningEffort??'SDK default',claude:'SDK default',scope:'Requested effort; effective provider behavior unverified'},claudeMaxCallUsd:0.50,knownCostSessionAdvisoryUsd:3},versions,node:process.version,platform:process.platform,arch:process.arch};
 const protocolHash=hash(JSON.stringify(spec));
 const synthetic=command!=='live';
 if(command==='live'){
  if(selection.providers.some(id=>selection.models[id]!.startsWith('MOCK-')))throw Error('Mock placeholders are not eligible live models');
  if(dirty)throw Error('Live preflight requires a clean isolated committed checkout');
  if(!authorizationPath)throw Error('Explicit authorization record required before inference');
  const a=json(authorizationPath);
  if(a.protocolHash!==protocolHash||a.maxCalls!==spec.maxCalls||a.authorized!==true||!a.accountEligibilityConfirmed||!a.approvedBy||!a.preflightEvidence)throw Error('Authorization must match exact preflight hash, call cap, eligible accounts and reviewed offline evidence');
  if(process.env.KOINOUS_ENABLE_INFERENCE!=='1'||process.env.GROK_BUILD_ENABLE_INFERENCE!=='0')throw Error('Live requires explicit Koinous opt-in and Grok off');
 }else if(process.env.KOINOUS_ENABLE_INFERENCE!=='0'||process.env.GROK_BUILD_ENABLE_INFERENCE!=='0')throw Error('Offline commands require both inference flags explicitly 0');
 // Pin all execution settings that affect Engine admission/deadlines; no inherited overrides.
 for(const k of ['CODEX_TIMEOUT_MS','CLAUDE_TIMEOUT_MS','MAX_SESSION_TOKENS','MAX_SESSION_USD','CODEX_WORKDIR','CLAUDE_WORKDIR'])if(process.env[k]!==undefined)throw Error(`Unset ${k} for the registered protocol`);
 if(process.env.MODEL_TIMEOUT_MS!==undefined&&process.env.MODEL_TIMEOUT_MS!=='120000'||process.env.MAX_SESSION_CALLS!==undefined&&process.env.MAX_SESSION_CALLS!=='6')throw Error('Conflicting deadline/call settings');
 process.env.MODEL_TIMEOUT_MS='120000';process.env.MAX_SESSION_CALLS='6';
 process.env.CLAUDE_MAX_CALL_USD='0.50';
 process.env.CODEX_WORKDIR=repo;process.env.CLAUDE_WORKDIR=repo;
 process.env.KOINOUS_PROVIDERS=selection.providers.includes('claude')?'codex,claude':'codex';
 const out=resolve(output);if(existsSync(out))throw Error('Output must be a new directory; no reruns/resume in place');mkdirSync(out,{recursive:true,mode:0o700});
 const manifest={...spec,protocolHash,synthetic,createdAt:new Date().toISOString(),authorization:command==='live'?json(authorizationPath):null};
 writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({protocolHash,maxCalls:spec.maxCalls,dirty,output:out,synthetic},null,2));
 if(command!=='preflight'){
  const controller=new AbortController();const stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
  const results:EvaluationResult[]=[];
  let stopped=false;
  const factory:Factory=s=>createAdapters(synthetic?'mock':'real',s.providers,s.models,reasoningEffort).map((adapter):Adapter=>({...adapter,id:adapter.id,prepare:adapter.prepare?.bind(adapter),dispose:adapter.dispose?.bind(adapter),run:async(prompt,round,signal)=>{appendFileSync(join(out,'prompts.jsonl'),JSON.stringify({agent:adapter.id,round,sha256:hash(prompt),prompt})+'\n');return adapter.run(prompt,round,signal);}}));
  try{
   for(let ti=0;ti<tasks.length;ti++){
    // Predeclared rotation limits fixed-order confounding; no outcome-driven reorder.
    const arms=[...ARMS.slice(ti%ARMS.length),...ARMS.slice(0,ti%ARMS.length)];
    for(const arm of arms){
     if(controller.signal.aborted){stopped=true;break;}
     const result=await executeCell(tasks[ti],selection,arm,out,factory,controller.signal);
     results.push(result);appendFileSync(join(out,'results.jsonl'),JSON.stringify(result)+'\n');
     // Genuine provider failures remain evidence. Stop the attempt; never silently rerun.
     if(result.status!=='completed'||result.events.some(e=>e.type==='cleanup.failed')){stopped=true;break;}
    }
    if(stopped)break;
   }
  }catch(error){stopped=true;writeFileSync(join(out,'fatal.json'),JSON.stringify({error:String(error),comparisonValid:false,restartRequiresAuthorization:true}));}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  const blind=blindPackets(results,allTasks,randomBytes(32).toString('hex'));mkdirSync(join(out,'review'));
  writeFileSync(join(out,'review/packets.json'),JSON.stringify(blind.packets,null,2));
  writeFileSync(join(out,'private-key.json'),JSON.stringify(blind.key,null,2),{mode:0o600});
  writeFileSync(join(out,'metrics.json'),JSON.stringify({synthetic,stopped,completedCells:results.length,plannedCells:tasks.length*ARMS.length,metrics:observability(results)},null,2));
  writeFileSync(join(out,'dashboard.html'),dashboardHtml(results,synthetic,tasks.length*ARMS.length));
  if(stopped)process.exitCode=2;
 }
}
