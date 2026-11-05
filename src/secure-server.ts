import {AGENTS,PROVIDER_LABELS} from './core.ts';
import {SDKWorkers} from './sdk-worker.ts';
import {WorkerProfiles} from './worker-profiles.ts';
import {ProfileWorkers} from './profile-worker.ts';
import {createServer} from 'node:http';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {Readable} from 'node:stream';
import {readFileSync,openSync,closeSync,unlinkSync,constants} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createApplication} from './server.ts';
import {modelDefaults} from './selection.ts';
import {configuredProviders,enabledProviders} from './provider-config.ts';
import {createAdapters} from './adapters.ts';
import {authenticate,containsSensitive,guardedAdapter,principals,privateDirectory,SecurityAudit} from './security.ts';
import {BrowserAuth} from './browser-auth.ts';
import type {OidcConfig,TokenExchange,Identity} from './browser-auth.ts';

type Options={root:string;workerProfiles?:unknown;principals?:unknown;oidc?:OidcConfig;exchange?:TokenExchange;now?:()=>number;mode?:'mock'|'real';port?:number;adapterFactory?:typeof createAdapters};
export function createProtectedApplication(options:Options){
 const mode=options.mode??'real',port=options.port??3031;
 const browser=options.oidc?new BrowserAuth(options.oidc,`http://127.0.0.1:${port}`,options.exchange,options.now):undefined;
 const users=options.principals===undefined&&browser?[]:principals(options.principals);
 if(!['real','mock'].includes(mode)||!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid protected server configuration');
 const root=resolve(options.root);const fromLegacy=relative(resolve('runs'),root);
 if(!fromLegacy||!fromLegacy.startsWith('..')&&!isAbsolute(fromLegacy))throw Error('Protected storage must be outside the legacy runs tree');
 privateDirectory(root);privateDirectory(join(root,'tenants'));
 const tenants=new Set([...users.map(p=>p.tenant),...browser?.tenants()??[]]);
 for(const tenant of tenants)privateDirectory(join(root,'tenants',tenant));
 const lockPath=join(root,'security.lock');
 const lock=openSync(lockPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
 const unlock=()=>{closeSync(lock);unlinkSync(lockPath);};
 let audit:SecurityAudit;
 try{audit=new SecurityAudit(join(root,'security-audit.jsonl'));}catch(e){unlock();throw e;}
 let profiles:WorkerProfiles;
 try{profiles=new WorkerProfiles(root,options.workerProfiles??[],[...users,...options.oidc?.members??[]]);}catch(e){unlock();throw e;}
 const workers=new ProfileWorkers(),sdkWorkers=new SDKWorkers();
 const apps=new Map<string,ReturnType<typeof createApplication>>();
 try{for(const tenant of tenants){
  const outputDir=join(root,'tenants',tenant);privateDirectory(outputDir);
  apps.set(tenant,createApplication({mode,port,outputDir,adapterFactory:(m,ids,models,effort,claudeEffort,decisionOnly)=>(options.adapterFactory??createAdapters)(m,ids,models,effort,claudeEffort,decisionOnly).map(a=>guardedAdapter(a,()=>audit.record({tenant,action:'provider.content',decision:'deny',reason:'dlp'})))}));
 }}catch(e){unlock();throw e;}
 let stopping=false,closing:Promise<void>|undefined;
 const json=(res:ServerResponse,status:number,error:string)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({error}));};
 const handler=async(req:IncomingMessage,res:ServerResponse)=>{
  let principal:Identity|undefined,action='unknown',resource:string|undefined;
  const deny=(status:number,reason:string)=>{audit.record({subject:principal?.subject,tenant:principal?.tenant,action,resource,decision:'deny',reason});json(res,status,reason);};
  try{
   const url=new URL(req.url??'/','http://127.0.0.1');
   const sessionRoute=url.pathname.match(/^\/api\/sessions\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(?:\/(events|report|cancel|interventions))?$/);
   resource=sessionRoute?.[1];
   action=sessionRoute?'session.'+(sessionRoute[2]??'details'):url.pathname==='/api/sessions'?(req.method==='POST'?'session.create':'session.list'):url.pathname==='/api/health'?'health':'unknown';
   // No trusted proxy headers, query credentials or cross-origin browser access.
   if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`)return deny(403,'host_denied');
   if(req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return deny(403,'origin_denied');
   if(req.headers['sec-fetch-site']==='cross-site'&&!(browser&&req.method==='GET'&&url.pathname==='/auth/callback'))return deny(403,'origin_denied');
   if([...url.searchParams.keys()].some(k=>/token|authorization|credential/i.test(k)))return deny(400,'query_credentials_denied');
   const origin=`http://127.0.0.1:${port}`;
   if(browser&&req.headers.host!==`127.0.0.1:${port}`)return deny(403,'canonical_host_required');
   if(browser&&req.method==='GET'&&url.pathname==='/auth/login'){
    if(stopping)return deny(503,'shutting_down');
    audit.record({action:'auth.login',decision:'allow',reason:'login_started'});
    const login=browser.start();res.writeHead(302,{'Location':login.location,'Set-Cookie':login.cookie,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end();
   }
   if(browser&&req.method==='GET'&&url.pathname==='/auth/callback'){
    if(stopping)return deny(503,'shutting_down');
    try{const login=await browser.finish(url.searchParams,req.headers.cookie);
     audit.record({...login.identity,action:'auth.login',decision:'allow',reason:'identity_verified'});
     res.writeHead(303,{'Location':'/','Set-Cookie':login.cookies,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end();
    }catch{audit.record({action:'auth.login',decision:'deny',reason:'identity_rejected'});res.writeHead(401,{'Content-Type':'text/plain','Set-Cookie':browser.clearTransaction(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});return res.end('Enterprise login failed. Start a new login.');}
   }
   const browserSession=browser?.session(req.headers.cookie);
   if(browserSession&&req.headers.authorization)return deny(401,'ambiguous_authentication');
   principal=browserSession?.identity??authenticate(req.headers.authorization,users);
   if(browser&&!principal&&req.method==='GET'&&url.pathname==='/'){
    audit.record({action:'auth.page',decision:'allow',reason:'public_login_page'});
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});
    return res.end('<!doctype html><title>synqo login</title><h1>synqo</h1><p>Sign in to review your organization’s discussions.</p><a href="/auth/login">Enterprise sign in</a>');
   }
   if(browserSession&&req.method!=='GET'&&(req.headers.origin!==origin||req.headers['x-csrf-token']!==browserSession.csrf))return deny(403,'csrf_denied');
   if(!principal)return deny(401,'authentication_required');
   if(stopping)return deny(503,'shutting_down');
   if(browser&&req.method==='GET'&&url.pathname==='/api/auth/session'){
    if(!browserSession)return deny(401,'browser_session_required');
    audit.record({...principal,action:'auth.session',decision:'allow',reason:'session_inspected'});
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({subject:principal.subject,tenant:principal.tenant,csrfToken:browserSession.csrf,expiresAt:browserSession.expires}));
   }
   if(browser&&req.method==='POST'&&url.pathname==='/auth/logout'){
    if(!browserSession)return deny(401,'browser_session_required');
    audit.record({...principal,action:'auth.logout',decision:'allow',reason:'session_revoked'});
    res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':browser.revoke(req.headers.cookie),'Cache-Control':'no-store'});return res.end('{"ok":true}');
   }
   let forwarded=req;
   if(req.method==='GET'&&url.pathname==='/api/worker-profiles'){
    audit.record({...principal,action:'worker.profiles',decision:'allow',reason:'own_profiles_listed'});
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({profiles:profiles.list(principal),inferenceEnabled:false}));
   }
   if(req.method==='POST'){
    let data='';for await(const chunk of req){data+=chunk;if(Buffer.byteLength(data)>16000)return deny(413,'body_too_large');}
    let parsed:unknown;try{parsed=JSON.parse(data||'{}');}catch{return deny(400,'invalid_json');}
    if(containsSensitive(parsed))return deny(422,'sensitive_content_blocked');
    if(parsed&&typeof parsed==='object'&&'grounding' in parsed&&parsed.grounding!=='none')return deny(403,'grounding_deferred');
    const preflight=url.pathname.match(/^\/api\/worker-profiles\/(codex|claude|grok)\/(preflight|sdk-preflight)$/);
    if(preflight){
     const sdk=preflight[2]==='sdk-preflight';
     action='worker.'+(sdk?'sdk-preflight.':'preflight.')+preflight[1];
     if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).length)return deny(400,'worker_parameters_denied');
     const profile=profiles.resolve(principal,preflight[1]);if(!profile)return deny(404,'worker_profile_unavailable');
     audit.record({...principal,action,decision:'allow',reason:sdk?'sdk_import_started':'metadata_inspection_started'});
     const controller=new AbortController();const abort=()=>controller.abort();req.once('aborted',abort);
     if(typeof res.once==='function')res.once('close',abort);
     try{const result=await (sdk?sdkWorkers:workers).inspect(profile,controller.signal);
      audit.record({...principal,action,decision:'allow',reason:sdk?'sdk_import_completed':'metadata_inspection_completed'});
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(result));
     }catch{return deny(503,'worker_preflight_failed');}
     finally{req.off('aborted',abort);if(typeof res.off==='function')res.off('close',abort);}
    }
    // Inspection profiles are not yet an approved OS sandbox for provider SDK execution.
    if(mode==='real'&&url.pathname==='/api/sessions')return deny(403,'tenant_provider_isolation_pending');
    forwarded=Object.assign(Readable.from([data]),{url:req.url,method:req.method,headers:req.headers}) as IncomingMessage;
   }
   audit.record({subject:principal.subject,tenant:principal.tenant,action,resource,decision:'allow',reason:'authenticated_access_attempt'});
   if(url.pathname==='/api/models')return deny(403,'tenant_provider_isolation_pending');
   if(req.method==='GET'&&url.pathname==='/api/health'){
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(JSON.stringify({status:'ok',mode,authentication:browserSession?'browser-session':'application-bearer',providerAuthentication:mode==='real'?'subscription':'mock',inferenceEnabled:mode==='mock',uiSupported:!!browser,agents:configuredProviders(),availableProviders:enabledProviders().filter(id=>(AGENTS as readonly string[]).includes(id)).map(id=>({id,label:PROVIDER_LABELS[id],defaultModel:modelDefaults()[id]||''}))}));
   }
   if(browser&&req.method==='GET'&&url.pathname==='/'){
    const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8').replace('<script src="/app.js"','<script src="/browser-session.js"></script><script src="/app.js"');
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'});return res.end(html);
   }
   if(browser&&req.method==='GET'&&url.pathname==='/browser-session.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end(readFileSync(new URL('../public/browser-session.js',import.meta.url)));}
   if(browser&&req.method==='GET'&&url.pathname==='/app.js')return apps.get(principal.tenant)!.handler(forwarded,res);
   if(!url.pathname.startsWith('/api/'))return json(res,404,'protected_api_only');
   if(browserSession&&req.method==='GET'&&sessionRoute?.[2]==='events'){
    const cleanup=browser!.watch(req.headers.cookie,()=>{res.end();req.emit('close');});
    if(typeof res.once==='function')res.once('close',cleanup);
    req.once('close',cleanup);
   }
   await apps.get(principal.tenant)!.handler(forwarded,res);
  }catch{json(res,503,'security_boundary_unavailable');}
 };
 return {handler,port,host:'127.0.0.1',shutdown(){stopping=true;browser?.clear();return closing??=Promise.all([workers.shutdown(),sdkWorkers.shutdown(),...[...apps.values()].map(a=>a.shutdown())]).then(()=>{}).finally(unlock);}};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const configPath=process.env.KOINOUS_SECURITY_CONFIG;if(!configPath)throw Error('KOINOUS_SECURITY_CONFIG is required');
 const config=JSON.parse(readFileSync(configPath,'utf8'));
 const app=createProtectedApplication({...config,mode:'real'});
 const server=createServer(app.handler).listen(app.port,app.host,()=>console.log(`synqo protected review API at http://${app.host}:${app.port}; inference disabled`));
 const stop=()=>{server.close();void app.shutdown().finally(()=>server.closeAllConnections());};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
