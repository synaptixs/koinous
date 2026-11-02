import {ProviderFailure} from './provider-runtime.ts';
import {spawn} from 'node:child_process';

// Trusted launcher only; callers supply a compiled deny-escape OS policy.
// The process group is created before that policy is applied. Descendants cannot
// move groups or create new sessions once the kernel policy is active.
export function confinedProcess(command:string,args:string[],env:Record<string,string>,cwd:string,input:string,signal:AbortSignal,timeoutMs:number){
 if(signal.aborted)throw new ProviderFailure('cancelled','Confined process unavailable',{usage:{usd:null}});
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid confined deadline');
 const child=spawn(command,args,{env,cwd,detached:true,shell:false,stdio:['pipe','pipe','pipe']});
 let stop=()=>{};
 const done=new Promise<string>((resolve,reject)=>{
  let failed=false,output='',bytes=0,reason='provider_error';
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')failed=true;}};
  stop=()=>{failed=true;kill();};const abort=()=>{reason='cancelled';stop();};const timer=setTimeout(()=>{reason='timeout';stop();},timeoutMs);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  child.stdin.on('error',stop);child.once('error',()=>{failed=true;});
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)stop();else output+=chunk.toString();});child.stderr.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)stop();});
  child.once('exit',kill);child.once('close',code=>{clearTimeout(timer);signal.removeEventListener('abort',abort);if(failed||code!==0)reject(new ProviderFailure(reason,'Confined process failed',{usage:{usd:null}}));else resolve(output);});
  child.stdin.end(input);
 });
 return {done,stop:()=>stop()};
}
