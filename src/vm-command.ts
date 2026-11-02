import {spawn} from 'node:child_process';

export type VMCommand = (binary:string,args:string[],timeoutMs:number,signal?:AbortSignal)=>Promise<string>;
// Never echo command output or stderr in errors: authentication diagnostics may contain secrets.
export const vmCommand:VMCommand=(binary,args,timeoutMs,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new Error('VM operation cancelled'));return;}
  const child=spawn(binary,args,{shell:false,stdio:['ignore','pipe','ignore'],env:{
    PATH:process.env.PATH,HOME:process.env.HOME,CONTAINERS_MACHINE_PROVIDER:'applehv'}});
  let output='',failed=false,killTimer:ReturnType<typeof setTimeout>|undefined;
  const stop=()=>{failed=true;child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),1000);};
  const timer=setTimeout(stop,timeoutMs);
  signal?.addEventListener('abort',stop,{once:true});
  child.stdout.on('data',chunk=>{if(Buffer.byteLength(output)+chunk.length>65536)stop();else output+=chunk;});
  child.once('error',()=>{failed=true;});
  // Wait for close even after cancellation so a late init cannot race removal.
  child.once('close',code=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal?.removeEventListener('abort',stop);
    if(failed||code!==0)reject(new Error('VM operation failed, cancelled, or exceeded its limit'));
    else resolve(output);
  });
});
