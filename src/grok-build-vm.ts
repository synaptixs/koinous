import {grokEgressHosts} from './grok-egress-config.ts';
import {readFileSync} from 'node:fs';
import {isAbsolute, join} from 'node:path';
import {spawn} from 'node:child_process';
import type {BuildSpawn} from './grok-build.ts';
import {ProviderFailure} from './provider-runtime.ts';

export type VMConnection={podman:string;vm:string;authHome:string;egressHosts?:readonly string[]};
export const GUEST_CWD='/tmp/workspace';
const fail=()=>new ProviderFailure('configuration','Configure an absolute GROK_BUILD_PODMAN path, dedicated koinous-grok-* GROK_BUILD_VM, and absolute GROK_BUILD_AUTH_HOME; isolated runtime never falls back',{usage:{usd:null}});

export function spawnIsolatedBuild(model:string, timeoutMs:number, spawnProcess:BuildSpawn=o=>spawn(o.binary,o.args,{env:o.env,cwd:o.cwd,shell:false,stdio:['pipe','pipe','pipe']}), connection?:Readonly<VMConnection>) {
  const binary=connection?.podman??process.env.GROK_BUILD_PODMAN, vm=connection?.vm??process.env.GROK_BUILD_VM, home=connection?.authHome??process.env.GROK_BUILD_AUTH_HOME;
  if(!binary || !isAbsolute(binary) || !vm || !/^koinous-grok-[a-z0-9-]+$/.test(vm) || !home || !isAbsolute(home))throw fail();
  const egressHosts=grokEgressHosts(connection?connection.egressHosts??[]:undefined);
  let auth:Buffer;
  try {auth=readFileSync(join(home,'auth.json'));if(auth.length>128*1024)throw Error();JSON.parse(auth.toString());}
  catch {throw new ProviderFailure('authentication','Grok Build browser credential unavailable or invalid',{usage:{usd:null}});}
  const source=readFileSync(new URL('../scripts/runtime/grok-build-guest.py',import.meta.url)).toString('base64');
  // Only trusted bundled source enters the remote shell. Credential/model remain on stdin.
  const command=`/usr/bin/python3 -c 'import base64;exec(base64.b64decode("${source}"))'`;
  const child=spawnProcess({binary,args:['machine','ssh',vm,command],cwd:process.cwd(),
    env:{PATH:process.env.PATH,HOME:process.env.HOME,CONTAINERS_MACHINE_PROVIDER:'applehv'}});
  child.stdin.on('error',()=>{});
  child.stdin.write(JSON.stringify({auth:auth.toString('base64'),model,timeoutMs,networkPolicy:egressHosts.length?'restricted':'deny-all',egressHosts})+'\n');
  auth.fill(0);
  return child;
}
