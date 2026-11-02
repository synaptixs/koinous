// Fixed vocabulary only. No provider payload, destination, error text or identifiers.
export const PROXY_COUNTERS=['accepted','attemptLimit','concurrencyLimit','header','host','dns','dial','lifetime','byteLimit','io','tunnels'] as const;
export type ProxyCounters=Readonly<Record<typeof PROXY_COUNTERS[number],number>>;
export type GrokDiagnostics=Readonly<{version:1;progress:Readonly<{messageChunks:number;thoughtChunks:number;sessionNotifications:number}>;proxy:ProxyCounters|null;proxySnapshots:number}>;
const MAX=2147483647;
export class GrokDiagnosticsCollector {
 private progress={messageChunks:0,thoughtChunks:0,sessionNotifications:0};
 private proxy:ProxyCounters|null=null;
 private snapshots=0;
 private line='';private dropping=false;
 observe(kind:keyof GrokDiagnostics['progress']){this.progress[kind]=Math.min(MAX,this.progress[kind]+1);}
 // Streaming bounded lines; an oversized line cannot masquerade as a valid suffix.
 stderr(chunk:Buffer){
  for(const byte of chunk){
   if(byte===10){if(!this.dropping)this.frame(this.line);this.line='';this.dropping=false;}
   else if(!this.dropping){if(this.line.length>=1024){this.line='';this.dropping=true;}else this.line+=String.fromCharCode(byte);}
  }
 }
 private frame(line:string){
  const prefix='KOINOUS_GROK_PROXY_V1 ';
  if(!line.startsWith(prefix)||this.snapshots>=122)return;
  let value:any;try{value=JSON.parse(line.slice(prefix.length));}catch{return;}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==PROXY_COUNTERS.length)return;
  if(PROXY_COUNTERS.some(k=>!Number.isInteger(value[k])||value[k]<0||value[k]>MAX))return;
  if(this.proxy&&PROXY_COUNTERS.some(k=>value[k]<this.proxy![k]))return;
  this.proxy=Object.freeze(Object.fromEntries(PROXY_COUNTERS.map(k=>[k,value[k]]))) as ProxyCounters;
  this.snapshots++;
 }
 snapshot():GrokDiagnostics{return Object.freeze({version:1,progress:Object.freeze({...this.progress}),proxy:this.proxy,proxySnapshots:this.snapshots});}
}
