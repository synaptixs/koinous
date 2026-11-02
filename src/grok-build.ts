import {GrokDiagnosticsCollector} from './grok-diagnostics.ts';
import {GrokTiming} from './grok-protocol-timing.ts';
import {StringDecoder} from 'node:string_decoder';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, isAbsolute} from 'node:path';
import type {Adapter, Reply, Round, Usage} from './core.ts';
import {grokBuildUsage} from './grok-build-usage.ts';
import {spawnIsolatedBuild, GUEST_CWD, type VMConnection} from './grok-build-vm.ts';
import {ProviderFailure, callTimeoutMs} from './provider-runtime.ts';

export const GROK_BUILD_VERSION = '1.0.70';
// Official macOS arm64 artifact downloaded from https://x.ai/cli on 2026-11-01.
export const GROK_BUILD_SHA256 = '5c8a688251bf61e35370b828b6a353b0a20fcc3f64000de8a91d426039f29cec';
export type BuildLaunch = {binary: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv};
export type BuildSpawn = (launch: BuildLaunch) => ChildProcessWithoutNullStreams;
const start: BuildSpawn = o => spawn(o.binary, o.args, {cwd:o.cwd, env:o.env, shell:false, stdio:['pipe','pipe','pipe']});
const failure = (code: string, message: string) => new ProviderFailure(code, message, {usage:{usd:null}});

export function buildEnvironment(home: string): NodeJS.ProcessEnv {
  // Never inherit API keys, endpoint overrides, proxy settings, or other providers' credentials.
  const env: NodeJS.ProcessEnv = {PATH:process.env.PATH, HOME:process.env.HOME, TMPDIR:process.env.TMPDIR,
    GROK_HOME:home, GROK_DISABLE_AUTOUPDATER:'1', GROK_MEMORY:'0', GROK_SUBAGENTS:'0', GROK_GOAL:'0',
    GROK_WRITE_FILE:'0', GROK_WEB_FETCH:'0', GROK_LSP_TOOLS:'0', GROK_TELEMETRY_ENABLED:'0', GROK_FEEDBACK_ENABLED:'0'};
  for(const source of ['CURSOR','CLAUDE'])for(const kind of ['SKILLS','RULES','AGENTS','MCPS','HOOKS'])env[`GROK_${source}_${kind}_ENABLED`]='0';
  return env;
}

// Small JSON-RPC client: no filesystem/terminal capabilities, no permission approval.
export async function buildProtocol(child: ChildProcessWithoutNullStreams, cwd: string, signal: AbortSignal, prompt?: string, graceful=false, authMethod='cached_token'): Promise<Reply> {
  const timing=new GrokTiming();
  const diagnostics=new GrokDiagnosticsCollector();
  let usage:Usage={usd:null};
  const accountedFailure=(code:string,message:string)=>new ProviderFailure(code,message,{usage:{...usage},protocolTiming:timing.snapshot(),grokDiagnostics:diagnostics.snapshot()});
  let closed=false, closeCode:number|null=null;
  const closure=new Promise<void>(resolve=>child.once('close',(code:number|null)=>{closed=true;closeCode=code;resolve();}));
  let nextId=0, buffer='', text='', sessionId: string | undefined, stopped: Error | undefined;
  let totalBytes=0; const decoder=new StringDecoder('utf8');
  let diagnosticTail='', socketSandboxFailure=false;
  const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  const stop=(error:Error)=>{stopped=error;for(const p of pending.values())p.reject(error);pending.clear();if(graceful)child.stdin.end();else child.kill('SIGKILL');};
  const aborted=()=>{
    const error=signal.reason instanceof ProviderFailure?signal.reason:accountedFailure('cancelled','Grok Build request cancelled');
    // Enrich synchronously: the outer deadline race may settle before protocol teardown.
    error.details={...error.details,protocolTiming:timing.snapshot(),grokDiagnostics:diagnostics.snapshot()};stop(error);
  };
  const write=(value:unknown)=>child.stdin.write(JSON.stringify(value)+'\n');
  const request=(method:string, params:unknown):Promise<any>=>new Promise((resolve,reject)=>{
    if(stopped){reject(stopped);return;}
    const id=++nextId;pending.set(id,{resolve,reject});write({jsonrpc:'2.0',id,method,params});
  });
  const data=(chunk:Buffer)=>{
    totalBytes+=chunk.length;
    if(totalBytes>2*1024*1024){stop(accountedFailure('output_limit','Grok Build exceeded transport output limit'));return;}
    buffer+=decoder.write(chunk);
    while(buffer.includes('\n')){
      const end=buffer.indexOf('\n'), line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      let m:any;
      try{m=JSON.parse(line);}catch{stop(accountedFailure('invalid_response','Invalid Grok Build protocol output'));return;}
      if(!m || m.jsonrpc!=='2.0'){stop(accountedFailure('invalid_response','Invalid Grok Build protocol envelope'));return;}
      if(m.method && m.id!==undefined){
        if(m.method==='session/request_permission')write({jsonrpc:'2.0',id:m.id,result:{outcome:{outcome:'cancelled'}}});
        else write({jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Client capability disabled'}});
        stop(accountedFailure('tool_denied','Grok Build requested a disabled client capability'));return;
      }
      if(m.method==='session/update'){
        if(!sessionId || m.params?.sessionId!==sessionId)continue;
        const u=m.params?.update;
        if(u?.sessionUpdate==='agent_message_chunk')diagnostics.observe('messageChunks');
        if(u?.sessionUpdate==='agent_thought_chunk')diagnostics.observe('thoughtChunks');
        if(u?.sessionUpdate==='tool_call'){stop(accountedFailure('tool_denied','Grok Build attempted a tool call'));return;}
        if(u?.sessionUpdate==='agent_message_chunk' && u.content?.type==='text' && typeof u.content.text==='string')text+=u.content.text;
        // Thought chunks and context/cumulative usage notifications are not retained.
      }else if(m.method==='x.ai/session_notification'){
        if(sessionId && m.params?.sessionId===sessionId)diagnostics.observe('sessionNotifications');
      }else if(typeof m.id==='number'){
        const p=pending.get(m.id);if(!p)continue;pending.delete(m.id);
        if(m.error)p.reject(accountedFailure('provider_error','Grok Build rejected a protocol request'));
        else if(m.result && typeof m.result==='object')p.resolve(m.result);
        else p.reject(accountedFailure('invalid_response','Grok Build omitted protocol result'));
      }
    }
  };
  // Retain only a bounded matching window, never expose arbitrary stderr in reports.
  const diagnostic=(chunk:Buffer)=>{
    if(graceful)diagnostics.stderr(chunk);
    diagnosticTail=(diagnosticTail+chunk.toString('utf8')).slice(-4096);
    if(diagnosticTail.includes('socket deny resolution failed'))socketSandboxFailure=true;
  };
  const exited=()=>stop(socketSandboxFailure
    ? accountedFailure('sandbox_incompatible','Grok Build refused the sandbox because runtime socket denial could not be resolved; protections remain enabled')
    : accountedFailure('provider_error','Grok Build exited before completion'));
  const errored=()=>stop(accountedFailure('provider_error','Grok Build process failed'));
  child.stdout.on('data',data);child.stderr.on('data',diagnostic);child.on('error',errored);child.on('close',exited);child.stdin.on('error',errored);
  signal.addEventListener('abort',aborted,{once:true});
  try{
    if(signal.aborted)aborted();
    const init=await request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false}});
    if(init.protocolVersion!==1 || !Array.isArray(init.authMethods) || !init.authMethods.some((m:any)=>m.id===authMethod))throw accountedFailure('authentication','Grok Build cached browser login unavailable; no API fallback');
    timing.advance('authentication');
    await request('authenticate',{methodId:authMethod,_meta:{headless:true}});
    if(prompt===undefined){timing.complete();return {text:'Cached browser authentication succeeded; inference entitlement remains untested.',usage:{usd:null},protocolTiming:timing.snapshot(),grokDiagnostics:diagnostics.snapshot()};}
    timing.advance('session-creation');
    const session=await request('session/new',{cwd,mcpServers:[]});
    if(typeof session.sessionId!=='string' || !session.sessionId)throw accountedFailure('invalid_response','Grok Build omitted session ID');
    sessionId=session.sessionId;
    timing.advance('inference');
    const result=await request('session/prompt',{sessionId,prompt:[{type:'text',text:prompt}]});
    usage=grokBuildUsage(result);
    if(stopped)throw stopped;
    if(result.stopReason!=='end_turn')throw accountedFailure('incomplete_response','Grok Build did not finish a complete turn');
    if(!text.trim())throw accountedFailure('empty_response','Grok Build returned no public answer');
    timing.complete();return {text,sessionId,usage,protocolTiming:timing.snapshot(),grokDiagnostics:diagnostics.snapshot()};
  }catch(error){
    if(error instanceof ProviderFailure)error.details={...error.details,usage:{...usage},protocolTiming:error.details.protocolTiming??timing.snapshot(),grokDiagnostics:error.details.grokDiagnostics??diagnostics.snapshot()};
    throw error;
  }finally{
    signal.removeEventListener('abort',aborted);
    child.stdout.off('data',data);child.stderr.off('data',diagnostic);child.stderr.resume();diagnosticTail='';
    if(graceful){
      child.stdin.end();
      let cleanupTimer:ReturnType<typeof setTimeout>|undefined;
      try {await Promise.race([closure,new Promise<void>(resolve=>{cleanupTimer=setTimeout(resolve,5000);})]);}
      finally {if(cleanupTimer)clearTimeout(cleanupTimer);}
      if(closed && closeCode!==0)throw accountedFailure('cleanup_unverified','Grok isolated runtime exited unsuccessfully; guest cleanup is unconfirmed');
      if(!closed){child.kill('SIGKILL');throw accountedFailure('cleanup_unverified','Grok VM cleanup could not be confirmed; guest watchdog fires after 130 seconds; stop the dedicated VM if cleanup remains unconfirmed');}
    }else child.kill('SIGKILL');
    // Keep error listeners attached through process teardown to absorb EPIPE/exit races.
    for(const p of pending.values())p.reject(accountedFailure('cancelled','Grok Build process closed'));pending.clear();
  }
}

export class GrokBuildAdapter implements Adapter {
  readonly id='grok' as const;
  private model: string;
  constructor(model=process.env.GROK_BUILD_MODEL||'grok-4.7'){this.model=model;}
  async run(prompt:string,_round:Round,signal:AbortSignal):Promise<Reply>{
    if(process.env.GROK_BUILD_ENABLE_INFERENCE!=='1')throw failure('configuration','Grok Build inference is disabled; complete preflight and explicitly enable it first');
    return launchBuild(signal,prompt,undefined,this.model);
  }
}

export async function launchBuild(signal:AbortSignal, prompt?:string, spawnProcess:BuildSpawn=start, model=process.env.GROK_BUILD_MODEL||'grok-4.7', connection?:Readonly<VMConnection>):Promise<Reply>{
  signal.throwIfAborted();
  const runtime=process.env.GROK_BUILD_RUNTIME||'native';
  if(connection||runtime==='vm'){
    const requestedModel=model;
    const timeout=Math.min(callTimeoutMs('grok'),prompt===undefined?30000:120000);
    const controller=new AbortController(), abort=()=>controller.abort(signal.reason);
    signal.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(failure('timeout','Grok Build deadline exceeded')),timeout);
    try {
      if(signal.aborted)abort();controller.signal.throwIfAborted();
      return {...await buildProtocol(spawnIsolatedBuild(requestedModel,timeout,spawnProcess,connection),GUEST_CWD,controller.signal,prompt,true,'grok.com'),requestedModel};
    } finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
  }
  if(runtime!=='native')throw failure('configuration','Unknown Grok Build runtime; no fallback');
  const binary=process.env.GROK_BUILD_BINARY, authHome=process.env.GROK_BUILD_AUTH_HOME;
  if(!binary || !authHome || !isAbsolute(binary) || !isAbsolute(authHome))throw failure('configuration','Set absolute GROK_BUILD_BINARY and GROK_BUILD_AUTH_HOME paths');
  try{
    if(createHash('sha256').update(readFileSync(binary)).digest('hex')!==GROK_BUILD_SHA256)throw Error();
  }catch{throw failure('configuration','Grok Build binary does not match the pinned macOS arm64 1.0.70 artifact');}
  const root=mkdtempSync(join(tmpdir(),'koinous-build-')), home=join(root,'home'), cwd=join(root,'workspace');
  mkdirSync(home,{mode:0o700});mkdirSync(cwd,{mode:0o700});
  const controller=new AbortController(), abort=()=>controller.abort(signal.reason);
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    // Copy only login credentials into a fresh profile; never load the user's plugins/config/hooks.
    try{copyFileSync(join(authHome,'auth.json'),join(home,'auth.json'));chmodSync(join(home,'auth.json'),0o600);}catch{throw failure('authentication','Grok Build browser credentials unavailable; run grok login in the dedicated profile');}
    writeFileSync(join(home,'config.toml'),'[cli]\nauto_update = false\n[models]\nmax_retries = 0\nmax_completion_tokens = 1200\n[features]\ncodebase_indexing = false\n[session]\nload_envrc = false\n',{mode:0o600});
    const requestedModel=model;
    const args=['--tools','','--deny','*','--permission-mode','dontAsk','--sandbox','read-only','--max-turns','1','--no-plan','--no-subagents','--disable-web-search','agent','--no-leader','--model',requestedModel,'--reasoning-effort','low','stdio'];
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    timer=setTimeout(()=>controller.abort(failure('timeout','Grok Build deadline exceeded')),Math.min(callTimeoutMs('grok'),prompt===undefined?15000:120000));
    controller.signal.throwIfAborted();
    const result=await buildProtocol(spawnProcess({binary,args,cwd,env:buildEnvironment(home)}),cwd,controller.signal,prompt);
    return {...result,requestedModel};
  }finally{if(timer)clearTimeout(timer);signal.removeEventListener('abort',abort);rmSync(root,{recursive:true,force:true});}
}
