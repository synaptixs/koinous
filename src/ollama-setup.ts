import {ollamaEndpoint} from './ollama.ts';

// Explicit CLI aliases verified against the official model pages. These are setup
// examples, not a live catalog or a claim about account/model availability.
const EXAMPLES=Object.freeze([
 {model:'gpt-oss:20b-cloud',label:'GPT-OSS 20B',url:'https://ollama.com/library/gpt-oss:20b-cloud'},
 {model:'gpt-oss:120b-cloud',label:'GPT-OSS 120B',url:'https://ollama.com/library/gpt-oss:120b-cloud'},
 {model:'gemma4:cloud',label:'Gemma 4',url:'https://ollama.com/library/gemma4:cloud'},
]);

export function ollamaCloudSetup(){
 let endpoint:string|null=null;
 try{endpoint=ollamaEndpoint();}catch{/* Keep unrelated providers and saved views usable. */}
 // ollamaEndpoint accepts only literal loopback origins; quote IPv6 brackets too.
 const prefix=endpoint?`OLLAMA_HOST='${endpoint}' `:'';
 return {verifiedOn:'2026-11-05',scope:'Three setup examples; browse the full catalog for more models. Account access and quota are not verified.',catalogUrl:'https://ollama.com/search?c=cloud',docsUrl:'https://docs.ollama.com/cloud',endpoint,
  signInCommand:endpoint?prefix+'ollama signin':null,
  listCommand:endpoint?prefix+'ollama ls':null,
  examples:EXAMPLES.map(example=>({...example,registerCommand:endpoint?prefix+'ollama pull '+example.model:null})),
 };
}
