import childProcess from 'node:child_process';
import type {SpawnOptions} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

// Installed only in the confined SDK worker. Explicit current uid/gid selects
// libuv's fork/exec path on the validated macOS runtime. The kernel denies
// posix_spawn (including SETSID/SETPGROUP attributes), setsid and setpgid.
// This shim supplies compatibility, not the security boundary.
export function installConfinedSpawn(){
 if(process.platform!=='darwin'||!process.getuid||!process.getgid)throw Error('Unsupported confined spawn runtime');
 const uid=process.getuid(),gid=process.getgid(),original=childProcess.spawn;
 const spawn=((command:string,argsOrOptions?:readonly string[]|SpawnOptions,options?:SpawnOptions)=>{
  const args=Array.isArray(argsOrOptions)?argsOrOptions:[];
  const supplied=(Array.isArray(argsOrOptions)?options:argsOrOptions??options) as SpawnOptions|undefined;
  if(supplied?.detached||supplied?.uid!==undefined&&supplied.uid!==uid||supplied?.gid!==undefined&&supplied.gid!==gid)throw Error('Worker process identity changes denied');
  return original(command,args,{...supplied,uid,gid,detached:false});
 }) as typeof childProcess.spawn;
 childProcess.spawn=spawn;syncBuiltinESMExports();
 return ()=>{if(childProcess.spawn===spawn){childProcess.spawn=original;syncBuiltinESMExports();}};
}
