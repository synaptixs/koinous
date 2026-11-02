import {realpathSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import type {WorkerProfile} from './worker-profiles.ts';

// Inspection only: there is deliberately no network, write, fork or Mach-service
// grant. SDK execution requires a separate reviewed policy, never a fallback.
export function inspectionSandbox(profile:WorkerProfile,script:string,platform=process.platform){
 if(platform!=='darwin')throw Error('OS worker confinement requires macOS');
 const quote=(path:string)=>{if(!isAbsolute(path)||/[\x00-\x1f\x7f]/.test(path))throw Error('Invalid sandbox path');return JSON.stringify(path);};
 const executable=realpathSync(process.execPath);
 const report=process.report.getReport() as {sharedObjects?:string[]};
 const libraries=(report.sharedObjects??[]).filter(p=>!p.startsWith('/usr/lib/')&&!p.startsWith('/System/'));
 const runtime=[executable,...libraries.map(p=>{
  const resolved=realpathSync(p);
  if(resolved!==executable&&!resolved.endsWith('.dylib'))throw Error('Unsupported worker runtime dependency');
  return resolved;
 })];
 const literals=(paths:string[])=>[...new Set(paths)].map(p=>`(literal ${quote(p)})`).join(' ');
 const policy=`(version 1)
(deny default)
(import "dyld-support.sb")
(allow process-exec (literal ${quote(executable)}))
(allow sysctl-read)
(allow file-read* file-map-executable ${literals(runtime)} (subpath "/usr/lib") (subpath "/System/Library"))
(allow file-read* (literal ${quote(profile.workspace)}) (literal ${quote(realpathSync(script))}) (literal ${quote(join(profile.root,'owner.json'))}))
(allow file-read-metadata (subpath "/opt/homebrew/opt") ${runtime.map(p=>`(subpath ${quote(dirname(p))})`).join(' ')} ${[...runtime,...libraries].map(p=>`(path-ancestors ${quote(p)})`).join(' ')} (subpath ${quote(profile.root)}) (path-ancestors ${quote(executable)}) (path-ancestors ${quote(realpathSync(script))}))
(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
`;
 return {command:'/usr/bin/sandbox-exec',args:['-p',policy,executable,'--openssl-config=/dev/null']};
}
