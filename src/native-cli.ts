import {spawn} from 'node:child_process';
import {subscriptionEnvironment} from './provider-config.ts';
import type {SDKProvider} from './sdk-execution.ts';
export const CLI_PINS={codex:'0.166.0',claude:'2.1.316'} as const;
export type NativeCheck={cliVersion:string;startupOnly:true;versionCommandPassed:true;helpCommandPassed:true;stderrObserved:boolean};
type Output={stdout:string;stderrObserved:boolean};
export type NativeProbe=(file:string,args:readonly string[])=>Promise<Output>;
// Called inside the OS-confined SDK worker, after its fork/exec shim is installed.
const probe:NativeProbe=(file,args)=>new Promise((resolve,reject)=>{
 const child=spawn(file,[...args],{env:{...subscriptionEnvironment(),OPENSSL_CONF:'/dev/null',KOINOUS_ENABLE_INFERENCE:'0',GROK_BUILD_ENABLE_INFERENCE:'0'},shell:false,stdio:['ignore','pipe','pipe']});
 let stdout='',bytes=0,failed=false,stderrObserved=false;
 const stop=()=>{failed=true;child.kill('SIGKILL');};const timer=setTimeout(stop,2000);
 child.once('error',()=>{failed=true;});
 child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536)stop();else stdout+=chunk.toString();});
 child.stderr.on('data',chunk=>{stderrObserved=true;bytes+=chunk.length;if(bytes>65536)stop();});
 child.once('close',code=>{clearTimeout(timer);if(failed||code!==0)reject(Error('Native CLI startup check failed'));else resolve({stdout,stderrObserved});});
});
export async function nativeCLICompatibility(provider:SDKProvider,cli:string,run:NativeProbe=probe):Promise<NativeCheck>{
 if(provider!=='codex'&&provider!=='claude')throw Error('Unsupported native CLI');
 const version=await run(cli,['--version']);
 const expected=provider==='codex'?`codex-cli ${CLI_PINS.codex}`:`${CLI_PINS.claude} (Claude Code)`;
 if(version.stdout.trim()!==expected)throw Error('Native CLI version mismatch');
 const help=await run(cli,provider==='codex'?['exec','--help']:['--help']);
 if(!help.stdout.includes(provider==='codex'?'Usage: codex exec':'Usage: claude'))throw Error('Native CLI help contract mismatch');
 return {cliVersion:CLI_PINS[provider],startupOnly:true,versionCommandPassed:true,helpCommandPassed:true,stderrObserved:version.stderrObserved||help.stderrObserved};
}
