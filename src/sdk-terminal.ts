import type {Thread,ThreadItem,Usage as CodexUsage} from '@openai/codex-sdk';
import type {SDKMessage,Query} from '@anthropic-ai/claude-agent-sdk';
import {ProviderFailure} from './provider-runtime.ts';
import {codexUsage} from './codex-usage.ts';
import {claudeUsage} from './adapters.ts';
import type {Usage} from './core.ts';

// SDK aggregation is not a completion proof. Withhold text until a successful
// terminal event and clean exhaustion of the SDK-visible stream, without retries.
export function terminalCodexThread(thread:Pick<Thread,'id'|'runStreamed'>):Pick<Thread,'id'|'run'>{
 return {get id(){return thread.id;},async run(input,options){
  let completed=false,usage:CodexUsage|null=null,finalResponse='';const items:ThreadItem[]=[];
  const fail=(code:string)=>new ProviderFailure(code,'Codex stream did not complete safely',{usage:codexUsage(usage)});
  try{
   const {events}=await thread.runStreamed(input,options);
   for await(const event of events){
    if(options?.signal?.aborted)throw fail('cancelled');
    if(completed)throw fail('invalid_response');
    if(!event||typeof event.type!=='string')throw fail('invalid_response');
    if(event.type==='turn.failed'||event.type==='error')throw fail('provider_error');
    if(event.type==='turn.completed'){
     if(!event.usage||typeof event.usage!=='object'||Array.isArray(event.usage))throw fail('invalid_response');
     usage=event.usage;completed=true;
    }else if(event.type==='item.completed'){
     if(!event.item||typeof event.item.type!=='string')throw fail('invalid_response');
     if(event.item.type==='agent_message'){
      if(typeof event.item.text!=='string')throw fail('invalid_response');
      finalResponse=event.item.text;
     }
     items.push(event.item);
    }
   }
   if(options?.signal?.aborted)throw fail('cancelled');
   if(!completed)throw fail('incomplete_response');
   return {items,finalResponse,usage};
  }catch(error){if(error instanceof ProviderFailure)throw error;throw fail(options?.signal?.aborted?'cancelled':'provider_error');}
 }};
}

export function terminalClaudeStream(stream:AsyncIterable<SDKMessage>&Pick<Query,'close'>,signal?:AbortSignal):AsyncIterable<SDKMessage>&Pick<Query,'close'>{
 return {close:()=>stream.close(),async *[Symbol.asyncIterator](){
  let terminal:Extract<SDKMessage,{type:'result'}>|undefined;let usage:Usage={usd:null};
  const fail=(code:string)=>new ProviderFailure(code,'Claude stream did not complete safely',{usage});
  try{
   for await(const message of stream){
    if(signal?.aborted)throw fail('cancelled');
    if(terminal)throw fail('invalid_response');
    if(!message||typeof message.type!=='string')throw fail('invalid_response');
    if(message.type!=='result')continue;
    terminal=message;
    usage=claudeUsage(message.modelUsage||{},message.total_cost_usd);
    if(message.subtype==='success'&&(message.is_error!==false||typeof message.result!=='string'))throw fail('invalid_response');
   }
   if(signal?.aborted)throw fail('cancelled');
   if(!terminal)throw fail('incomplete_response');
   yield terminal;
  }catch(error){if(error instanceof ProviderFailure)throw error;throw fail(signal?.aborted?'cancelled':'provider_error');}
 }};
}
