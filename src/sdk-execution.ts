import {realpathSync,readFileSync,readdirSync,lstatSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectionSandbox} from './worker-sandbox.ts';
import {workerEnvironment} from './worker-profiles.ts';
import type {WorkerProfile} from './worker-profiles.ts';
export const SDK_PINS={codex:'0.166.0',claude:'0.3.316'} as const;
export type SDKProvider=keyof typeof SDK_PINS;
export type SDKBundle=Readonly<{root:string;script:string;provider:SDKProvider;cli:string}>;
export function sdkBundle(provider:string):SDKBundle {
 if(provider!=='codex'&&provider!=='claude')throw Error('Grok requires guest egress integration; host execution denied');
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('SDK worker requires macOS arm64');
 const root=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
 const pkg=provider==='codex'?'@openai/codex-sdk':'@anthropic-ai/claude-agent-sdk';
 if(JSON.parse(readFileSync(join(root,'node_modules',pkg,'package.json'),'utf8')).version!==SDK_PINS[provider])throw Error('SDK version mismatch');
 const native=provider==='codex'?'@openai/codex-darwin-arm64':'@anthropic-ai/claude-agent-sdk-darwin-arm64';
 const expected=provider==='codex'?'0.166.0-darwin-arm64':'0.3.316';
 if(JSON.parse(readFileSync(join(root,'node_modules',native,'package.json'),'utf8')).version!==expected)throw Error('CLI package version mismatch');
 const cli=realpathSync(provider==='codex'?join(root,'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex'):join(root,'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'));
 return Object.freeze({root,script:join(root,'scripts/runtime/sdk-worker.ts'),provider,cli});
}
export function executionSandbox(profile:WorkerProfile,bundle:SDKBundle,proxyPort?:number,credentialAccess=false){
 if(profile.provider!==bundle.provider)throw Error('Provider/profile mismatch');
 if(proxyPort!==undefined&&(!Number.isInteger(proxyPort)||proxyPort<1024||proxyPort>65535))throw Error('Invalid broker port');
 const launch=inspectionSandbox(profile,bundle.script),q=(p:string)=>{if(/[\x00-\x1f\x7f]/.test(p))throw Error('Invalid execution path');return JSON.stringify(realpathSync(p));};
 const icu=bundle.provider==='claude'?readdirSync('/usr/share/icu').filter(name=>/^icudt[0-9]+l\.dat$/.test(name)).sort().map(name=>{
  const path=join('/usr/share/icu',name),stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)throw Error('Untrusted system ICU data');
  return `(literal ${q(path)})`;
 }):[];
 if(bundle.provider==='claude'&&!icu.length)throw Error('System ICU data unavailable');
 // The same policy is inherited by SDK descendants. No wildcard network rule,
 // shell/helper execution, keychain services, or workspace writes are granted.
 launch.args[1]+=`
(allow file-read-metadata (path-ancestors ${q(join(bundle.root,'src'))}))
${icu.length?`(allow file-read* ${icu.join(' ')})`:''}
(allow process-fork)
(deny syscall-unix (syscall-number SYS_setsid SYS_setpgid SYS_posix_spawn))
(allow process-exec (literal ${q(bundle.cli)}))
(allow file-read* file-map-executable (literal ${q(bundle.cli)}))
(allow file-read* (subpath ${q(join(bundle.root,'src'))}) (subpath ${q(join(bundle.root,'node_modules'))}) (subpath ${q(join(bundle.root,'scripts/runtime'))}) (literal ${q(join(bundle.root,'package.json'))}))
${credentialAccess?`(allow file-read* file-write* (subpath ${q(profile.login)}))`:""}
(allow file-read* file-write* (subpath ${q(profile.tmp)}))
${proxyPort===undefined?'':`(allow network-outbound (remote tcp4 "localhost:${proxyPort}"))`}
`;
 return launch;
}
export function executionEnvironment(profile:WorkerProfile,proxyUrl?:string):Record<string,string>{
 if(proxyUrl!==undefined&&!/^http:\/\/worker:[a-f0-9]{64}@127\.0\.0\.1:[0-9]+$/.test(proxyUrl))throw Error('Invalid broker capability');
 return {...workerEnvironment(profile),PATH:dirname(realpathSync(process.execPath)),OPENSSL_CONF:'/dev/null',
  ...(proxyUrl?{HTTPS_PROXY:proxyUrl,HTTP_PROXY:proxyUrl,https_proxy:proxyUrl,http_proxy:proxyUrl,NO_PROXY:'',no_proxy:''}:{})};
}
