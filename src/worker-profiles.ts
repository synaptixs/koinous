import {constants,closeSync,fstatSync,lstatSync,openSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {AGENTS} from './core.ts';
import type {Identity} from './browser-auth.ts';
import {privateDirectory} from './security.ts';
// Ollama's personal daemon is not a tenant-isolated worker transport.
export type ProfileOwner=Identity&{provider:typeof AGENTS[number]};
export type WorkerProfile=Readonly<ProfileOwner&{root:string;home:string;login:string;workspace:string;tmp:string}>;
const id=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(v);
export class WorkerProfiles {
 private profiles:WorkerProfile[]=[];
 constructor(root:string,configured:unknown,identities:readonly Identity[]){
  privateDirectory(root);root=realpathSync(root);
  if(!Array.isArray(configured)||configured.length>300)throw Error('Invalid worker profile configuration');
  const known=new Set(identities.map(i=>JSON.stringify([i.tenant,i.subject]))),seen=new Set<string>();
  for(const p of configured){
   if(!p||Object.keys(p).some(k=>!['tenant','subject','provider'].includes(k))||!id(p.tenant)||!id(p.subject)||!AGENTS.includes(p.provider)||!known.has(JSON.stringify([p.tenant,p.subject])))throw Error('Worker profile owner is not configured');
   const key=JSON.stringify([p.tenant,p.subject,p.provider]);if(seen.has(key))throw Error('Duplicate worker profile');seen.add(key);
  }
  for(const p of configured){
   const base=join(root,'credential-profiles'),tenant=join(base,p.tenant),user=join(tenant,p.subject),path=join(user,p.provider);
   const home=join(path,'home'),login=join(home,({codex:'.codex',claude:'.claude',grok:'.grok'})[p.provider as ProfileOwner['provider']]);
   for(const dir of [base,tenant,user,path,home,login,join(path,'workspace'),join(path,'tmp')])privateDirectory(dir);
   const owner={version:1,tenant:p.tenant,subject:p.subject,provider:p.provider},file=join(path,'owner.json');
   try{const fd=openSync(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,JSON.stringify(owner));}finally{closeSync(fd);}}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
   const profile=Object.freeze({...p,root:path,home,login,workspace:join(path,'workspace'),tmp:join(path,'tmp')}) as WorkerProfile;
   this.check(profile);this.profiles.push(profile);
  }
 }
 private check(p:WorkerProfile){
  for(const dir of [p.root,p.home,p.login,p.workspace,p.tmp]){const stat=lstatSync(dir);if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw Error('Worker profile directory is unsafe');}
  const fd=openSync(join(p.root,'owner.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size>1024)throw Error('Worker owner record is unsafe');const owner=JSON.parse(readFileSync(fd,'utf8'));if(JSON.stringify(owner)!==JSON.stringify({version:1,tenant:p.tenant,subject:p.subject,provider:p.provider}))throw Error('Worker profile ownership mismatch');}finally{closeSync(fd);}
 }
 list(identity:Identity){return this.profiles.filter(p=>p.tenant===identity.tenant&&p.subject===identity.subject).map(p=>({provider:p.provider,authentication:'subscription',inferenceEnabled:false,authenticationVerified:false}));}
 resolve(identity:Identity,provider:string):WorkerProfile|undefined{const p=this.profiles.find(p=>p.tenant===identity.tenant&&p.subject===identity.subject&&p.provider===provider);if(p)this.check(p);return p;}
}
export function workerEnvironment(p:WorkerProfile):Record<string,string>{
 return {HOME:p.home,TMPDIR:p.tmp,TMP:p.tmp,TEMP:p.tmp,LANG:'C.UTF-8',XDG_CONFIG_HOME:join(p.home,'.config'),XDG_CACHE_HOME:join(p.home,'.cache'),
  ...p.provider==='codex'?{CODEX_HOME:p.login}:p.provider==='claude'?{CLAUDE_CONFIG_DIR:p.login}:{GROK_BUILD_AUTH_HOME:p.login},
  KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'};
}
