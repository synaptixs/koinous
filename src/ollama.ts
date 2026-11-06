import type {Adapter,Reply,Round,Usage} from './core.ts';
import {ProviderFailure,tokenCount} from './provider-runtime.ts';
import type {ReasoningEffort} from './reasoning.ts';

export type OllamaProvider='ollama-local'|'ollama-cloud';
export function isOllama(provider:string):provider is OllamaProvider{return provider==='ollama-local'||provider==='ollama-cloud';}
type Fetch=typeof fetch;
const validName=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(v);

// Only the trusted workstation daemon is supported. No keys, redirects or remote
// endpoint overrides: Ollama itself manages subscription signin for cloud models.
export function ollamaEndpoint(value=process.env.KOINOUS_OLLAMA_URL||'http://127.0.0.1:11434'):string{
 const url=new URL(value);
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new ProviderFailure('configuration','KOINOUS_OLLAMA_URL must be a loopback HTTP origin');
 return url.origin;
}
async function request(base:string,path:string,load:Fetch,signal:AbortSignal,body?:unknown):Promise<Record<string,unknown>>{
 signal.throwIfAborted();
 const response=await load(base+path,{method:body===undefined?'GET':'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 // Bound metadata/output memory; do not echo upstream errors, signin links or bodies.
 if(!response.ok){await response.body?.cancel();throw new ProviderFailure('provider_error',response.status===401||response.status===403?'Ollama authorization failed. For Cloud, run ollama signin outside synqo.':`Ollama request failed (HTTP ${response.status})`);}
 const reader=response.body?.getReader();if(!reader)throw new ProviderFailure('protocol_violation','Ollama response has no body');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4_000_000)throw new ProviderFailure('protocol_violation','Ollama response exceeds 4 MB');chunks.push(value);}}
 finally{try{await reader.cancel();}finally{reader.releaseLock();}}
 let data:unknown;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new ProviderFailure('protocol_violation','Ollama returned invalid JSON');}
 if(!data||typeof data!=='object'||Array.isArray(data)||'error' in data)throw new ProviderFailure('protocol_violation','Ollama returned an invalid response');
 return data as Record<string,unknown>;
}
// Use declared transport metadata, not a model-name suffix (aliases may hide it).
function location(data:Record<string,unknown>):OllamaProvider{
 const remote=data.remote_host,model=data.remote_model;
 if(remote===undefined&&model===undefined||remote===''&&(!model||model===''))return 'ollama-local';
 if(typeof remote!=='string'||typeof model!=='string'||!model)throw new ProviderFailure('configuration','Ollama remote model metadata is incomplete; update Ollama');
 let url:URL;try{url=new URL(remote);}catch{throw new ProviderFailure('configuration','Invalid Ollama remote host');}
 if(url.origin!=='https://ollama.com'||url.username||url.password||!['/','/api','/api/'].includes(url.pathname)||url.search||url.hash)throw new ProviderFailure('configuration','Only official Ollama Cloud models are supported');
 return 'ollama-cloud';
}
export async function ollamaModels(provider:OllamaProvider,load:Fetch=fetch,endpoint=ollamaEndpoint()){
 const data=await request(endpoint,'/api/tags',load,AbortSignal.timeout(10_000));
 if(!Array.isArray(data.models))throw new ProviderFailure('protocol_violation','Ollama model list is invalid');
 const models:string[]=[];let unsupported=0;
 for(const raw of data.models){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)){unsupported++;continue;}
  const item=raw as Record<string,unknown>;
  try{if(!validName(item.name))throw Error();if(location(item)===provider)models.push(item.name);}catch{unsupported++;}
 }
 const unique=[...new Set(models)].sort();
 return {provider,models:unique.slice(0,200),total:unique.length,truncated:unique.length>200,unsupported,source:'local-ollama-registry',inferencePerformed:false};
}
function thinkingValues(metadata:Record<string,unknown>):Array<string|boolean>{
 const thinking=metadata.thinking as {values?:unknown}|undefined;
 if(!thinking||!Array.isArray(thinking.values))return [];
 if(thinking.values.length>32)throw new ProviderFailure('protocol_violation','Ollama reasoning metadata exceeds supported bounds');
 return [...new Set(thinking.values.filter((value):value is string|boolean=>typeof value==='boolean'||typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)))];
}
export async function ollamaReasoning(provider:OllamaProvider,model:string,load:Fetch=fetch,endpoint=ollamaEndpoint()){
 if(!validName(model))throw new ProviderFailure('configuration','Choose an explicit Ollama model ID');
 const metadata=await request(endpoint,'/api/show',load,AbortSignal.timeout(10_000),{model});
 if(location(metadata)!==provider)throw new ProviderFailure('configuration','Model location does not match the selected provider');
 return {provider,model,values:thinkingValues(metadata),source:'local-ollama-metadata',inferencePerformed:false};
}
export class OllamaAdapter implements Adapter{
 readonly id:OllamaProvider;
 private model:string;
 private load:Fetch;
 private endpoint:string;
 private effort:ReasoningEffort;
 constructor(provider:OllamaProvider,model:string,load:Fetch=fetch,endpoint=ollamaEndpoint(),effort:ReasoningEffort=null){
  if(!validName(model))throw new ProviderFailure('configuration','Choose an explicit Ollama model ID');
  this.id=provider;this.model=model;this.load=load;this.endpoint=endpoint;this.effort=effort;
 }
 async prepare(signal:AbortSignal){
  const metadata=await request(this.endpoint,'/api/show',this.load,signal,{model:this.model});
  if(location(metadata)!==this.id)throw new ProviderFailure('configuration',`Selected model does not belong to ${this.id}; choose the matching Local or Cloud option`);
  if(!Array.isArray(metadata.capabilities)||!metadata.capabilities.includes('completion'))throw new ProviderFailure('configuration','Ollama model must declare text completion capability; update Ollama if metadata is unavailable');
  if(this.effort!==null&&!thinkingValues(metadata).includes(this.effort))throw new ProviderFailure('configuration','Selected reasoning level is not reported by this Ollama model; refresh reasoning choices');
 }
 async run(prompt:string,_round:Round,signal:AbortSignal):Promise<Reply>{
  // Revalidate on each call so a changed alias cannot silently switch location.
  await this.prepare(signal);
  const data=await request(this.endpoint,'/api/chat',this.load,signal,{model:this.model,messages:[{role:'user',content:prompt}],stream:false,...(this.effort===null?{}:{think:this.effort})});
  const usage:Usage={inputTokens:tokenCount(data.prompt_eval_count),outputTokens:tokenCount(data.eval_count),cacheReadTokens:tokenCount(data.prompt_eval_cached_count),usd:null};
  const details={model:typeof data.model==='string'?data.model:undefined,requestedModel:this.model,usage,accounting:{primary:usage,auxiliary:{},unclassified:{},auxiliaryVisibility:'not-reported' as const}};
  if(data.done!==true||data.done_reason!=='stop')throw new ProviderFailure('incomplete_response','Ollama response did not finish normally',details);
  const message=data.message as {content?:unknown;tool_calls?:unknown[]}|undefined;
  if(message?.tool_calls?.length)throw new ProviderFailure('protocol_violation','Text-only Ollama response requested tool work',details);
  if(typeof message?.content!=='string'||!message.content.trim())throw new ProviderFailure('empty_response','Ollama returned no assistant text',details);
  // No tools, filesystem, SDK history, system-profile import, automatic retries,
  // model pulls or fabricated effort settings. Thinking text is never retained.
  return {text:message.content,...details};
 }
}
