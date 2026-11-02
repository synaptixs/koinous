// Trusted inspection-only worker. No SDK imports, login, credential reads or inference.
import {lstatSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {connect} from 'node:net';
const fail=()=>{process.stdout.write(JSON.stringify({ok:false,error:'worker_preflight_failed'})+'\n');process.exitCode=1;};
try {
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>4096)throw Error();}
 const request=JSON.parse(input);
 if(Object.keys(request).sort().join(',')!=='kind,provider,root'||request.kind!=='inspect'||!['codex','claude','grok'].includes(request.provider)||typeof request.root!=='string')throw Error();
 const root=request.root,home=join(root,'home'),login=join(home,{codex:'.codex',claude:'.claude',grok:'.grok'}[request.provider]);
 const configKey={codex:'CODEX_HOME',claude:'CLAUDE_CONFIG_DIR',grok:'GROK_BUILD_AUTH_HOME'}[request.provider];
 if(process.env.HOME!==home||process.env[configKey]!==login||process.cwd()!==join(root,'workspace')||process.env.KOINOUS_ENABLE_INFERENCE!=='0'||process.env.GROK_BUILD_ENABLE_INFERENCE!=='0')throw Error();
 const scopes=['fs.write','child','worker','addons','net'];if(!process.permission||scopes.some(s=>process.permission.has(s)))throw Error();
 const owner=JSON.parse(readFileSync(join(root,'owner.json'),'utf8'));if(owner.provider!==request.provider)throw Error();
 const denied=fn=>{try{fn();return false;}catch(e){return e.code==='ERR_ACCESS_DENIED';}};
 const outsideDenied=denied(()=>readdirSync(dirname(root)));
 const processDenied=denied(()=>spawnSync(process.execPath,['--version']));
 const networkDenied=await new Promise(resolve=>{const socket=connect({host:'127.0.0.1',port:9});socket.once('error',e=>{socket.destroy();resolve(e.code==='ERR_ACCESS_DENIED');});socket.once('connect',()=>{socket.destroy();resolve(false);});});
 if(!outsideDenied||!processDenied||!networkDenied)throw Error();
 const file=join(login,request.provider==='claude'?'.credentials.json':'auth.json');let credentialFilePresent=false;
 try{const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size>128*1024)throw Error();credentialFilePresent=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 process.stdout.write(JSON.stringify({ok:true,provider:request.provider,credentialFilePresent,authenticationVerified:false,inferenceEnabled:false,checks:{outsideProfileDenied:outsideDenied,childProcessDenied:processDenied,networkDenied,filesystemWriteDenied:!process.permission.has('fs.write')}})+'\n');
}catch{fail();}
