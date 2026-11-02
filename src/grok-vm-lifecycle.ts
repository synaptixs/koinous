import {grokEgressHosts} from './grok-egress-config.ts';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,mkdirSync,mkdtempSync,copyFileSync,writeFileSync,rmSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import {vmCommand,type VMCommand} from './vm-command.ts';
import type {VMConnection} from './grok-build-vm.ts';

export const LINUX_BUILD_SHA256='3aa36883574b263088e5addffe241f55430e8daaee1a0c4934b02180007a9761';
export const SANDBOX_CHECKS=['rootReadOnly','workspaceReadOnly','runtimeSocketsHidden','hostHomeAbsent','guestHomeHidden','stagingHidden','otherProfilesHidden','profileWritable','credentialMode600','networkNamespaceIsolated','networkInterfacesIsolated'] as const;
export type VMConfig={podman:string;authHome:string;binary:string;image:string;imageSha256:string;stateDir:string;egressHosts?:readonly string[]};
export function vmConfig():VMConfig{
  return {egressHosts:grokEgressHosts(),podman:process.env.GROK_BUILD_PODMAN||'',authHome:process.env.GROK_BUILD_AUTH_HOME||'',
    binary:process.env.GROK_BUILD_LINUX_BINARY||'',image:process.env.GROK_BUILD_VM_IMAGE||'',
    imageSha256:process.env.GROK_BUILD_VM_IMAGE_SHA256||'',stateDir:join(homedir(),'.local/state/koinous')};
}
async function sha256(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
export async function verifyVMArtifacts(config:VMConfig){
  if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Managed Grok VM requires macOS arm64 AppleHV');
  if(await sha256(config.binary)!==LINUX_BUILD_SHA256||await sha256(config.image)!==config.imageSha256)throw Error('Pinned VM image or Grok binary checksum mismatch');
}
type Dependencies={command:VMCommand;verifyArtifacts:(config:VMConfig)=>Promise<void>};
type Machine={Name:string;Running:boolean;Starting?:boolean};
export class GrokVMLifecycle {
  readonly connection:Readonly<VMConnection>;
  private config:VMConfig;private deps:Dependencies;private stage?:string;private locked=false;private owned=false;private ready=false;private disposed=false;
  private disposal?:Promise<void>;
  private phase='new';private guestCredentialsAbsent:boolean|null=null;
  constructor(config:VMConfig=vmConfig(),deps:Partial<Dependencies>={}){
    this.config={...config,egressHosts:grokEgressHosts(config.egressHosts??[])};this.deps={command:vmCommand,verifyArtifacts:verifyVMArtifacts,...deps};
    this.connection=Object.freeze({egressHosts:this.config.egressHosts,podman:config.podman,authHome:config.authHome,vm:`koinous-grok-${randomUUID().replaceAll('-','').slice(0,16)}`});
  }
  private get lock(){return join(this.config.stateDir,'grok-vm.lock');}
  private journal(phase:string){this.phase=phase;writeFileSync(join(this.lock,'owner.json'),JSON.stringify({version:1,vm:this.connection.vm,stage:this.stage,phase,guestCredentialsAbsent:this.guestCredentialsAbsent},null,2),{mode:0o600});}
  private command(args:string[],timeout=30000,signal?:AbortSignal){return this.deps.command(this.config.podman,['machine',...args],timeout,signal);}
  private async machines(signal?:AbortSignal):Promise<Machine[]>{
    const rows:unknown=JSON.parse(await this.command(['list','--format','json'],30000,signal));
    if(!Array.isArray(rows)||rows.some(r=>!r||typeof r.Name!=='string'||typeof r.Running!=='boolean'||(r.Starting!==undefined&&typeof r.Starting!=='boolean')))throw Error('Invalid VM inventory');
    return rows;
  }
  async prepare(signal:AbortSignal){
    if(this.phase!=='new'||this.disposed)throw Error('VM lifecycle cannot be reused');
    signal.throwIfAborted();
    const c=this.config;
    if([c.podman,c.authHome,c.binary,c.image,c.stateDir].some(p=>!isAbsolute(p))||! /^[a-f0-9]{64}$/.test(c.imageSha256))throw Error('Managed Grok VM requires absolute paths and a pinned image SHA256');
    await this.deps.verifyArtifacts(c);signal.throwIfAborted();
    mkdirSync(c.stateDir,{recursive:true,mode:0o700});
    try{mkdirSync(this.lock,{mode:0o700});}catch{throw Error('Grok VM lifecycle locked; finish or recover the previous owned VM first');}
    this.locked=true;this.journal('locked');
    const machines=await this.machines(signal);
    if(machines.some(m=>m.Running||m.Starting||m.Name===this.connection.vm))throw Error('An existing VM is active; managed Grok will not modify it');
    this.stage=mkdtempSync(join(tmpdir(),'koinous-grok-stage-'));
    copyFileSync(c.binary,join(this.stage,'grok'));
    copyFileSync(new URL('../scripts/runtime/grok-egress.py',import.meta.url),join(this.stage,'egress.py'));
    copyFileSync(new URL('../scripts/runtime/grok-build-guest.py',import.meta.url),join(this.stage,'integrated-guest.py'));
    copyFileSync(new URL('../scripts/runtime/grok-sandbox-probe.py',import.meta.url),join(this.stage,'sandbox-probe.py'));
    // Journal ownership before init: failed/cancelled init can still leave a partial VM.
    this.owned=true;this.journal('initializing');
    await this.command(['init','--cpus','2','--memory','2048','--disk-size','10','--volume',`${this.stage}:/var/mnt/koinous:ro`,'--image',c.image,this.connection.vm],180000,signal);
    this.journal('starting');await this.command(['start',this.connection.vm],120000,signal);
    this.journal('verifying');
    await this.command(['ssh',this.connection.vm,'sudo mount -o remount,ro /var/mnt/koinous'],30000,signal);
    const checks=JSON.parse(await this.command(['ssh',this.connection.vm,'/usr/bin/python3 /var/mnt/koinous/sandbox-probe.py'],30000,signal));
    if(!checks||SANDBOX_CHECKS.some(key=>checks[key]!==true))throw Error('Grok sandbox verification failed');
    signal.throwIfAborted();this.ready=true;this.journal('sandbox-verified');
  }
  assertReady(){if(!this.ready||this.disposed)throw Error('Managed Grok VM is not verified');}
  dispose():Promise<void>{
    if(this.disposal)return this.disposal;
    this.disposal=this.disposeOwned().finally(()=>{this.disposal=undefined;});return this.disposal;
  }
  private async disposeOwned(){
    if(this.disposed||!this.locked)return;
    this.ready=false;
    try{
      this.journal('cleaning');
      if(this.owned){
        // Credential deletion is checked before teardown; VM absence is the final destruction gate.
        try{const result=await this.command(['ssh',this.connection.vm,"/usr/bin/python3 -c 'from pathlib import Path; import json; print(json.dumps(not any(Path(\"/dev/shm\").glob(\"koinous-build-*\"))))'"]);
          this.guestCredentialsAbsent=JSON.parse(result)===true;
        }catch{this.guestCredentialsAbsent=null;}
        try{await this.command(['stop',this.connection.vm],30000);}catch{/* removal still required */}
        try{await this.command(['rm','--force',this.connection.vm],60000);}catch{/* verify absence independently */}
        if((await this.machines()).some(m=>m.Name===this.connection.vm))throw Error('Owned Grok VM remains');
      }
      this.journal('removed');
      // Preserve a non-secret audit record, including whether pre-removal credential cleanup was observed.
      copyFileSync(join(this.lock,'owner.json'),join(this.config.stateDir,`${this.connection.vm}.json`));
      if(this.stage)rmSync(this.stage,{recursive:true,force:true});
      rmSync(this.lock,{recursive:true});this.locked=false;this.disposed=true;
    }catch{this.journal('cleanup-unverified');throw Error('Grok VM cleanup unverified; lifecycle lock retained for recovery');}
  }
}
