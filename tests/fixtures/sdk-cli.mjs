// Synthetic CLI wire peer. The test prepends a pinned Node shebang and fixture
// configuration. This file has no provider imports, credential reads or networking.
import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const log=value=>appendFileSync(fixture.trace,JSON.stringify(value)+'\n');
log({type:'launch',pid:process.pid,args:process.argv.slice(2),home:process.env.HOME,apiKeys:Object.keys(process.env).filter(k=>/API_KEY|AUTH_TOKEN/.test(k)),inference:process.env.KOINOUS_ENABLE_INFERENCE});
const usage={input_tokens:20,cached_input_tokens:7,output_tokens:5};
function answer(){
 if(fixture.scenario==='hang')return;
 if(fixture.scenario==='exit'){process.stderr.write('SYNTHETIC_PRIVATE_DIAGNOSTIC');process.exit(9);}
 if(fixture.scenario==='malformed'){process.stdout.write('{broken-json\n');process.exit(0);}
 if(fixture.provider==='codex'){
  emit({type:'thread.started',thread_id:'synthetic-thread'});
  if(fixture.scenario==='failure'){emit({type:'turn.failed',error:{message:'SYNTHETIC_PRIVATE_DIAGNOSTIC'}});process.exit(0);}
  if(fixture.scenario!=='empty')emit({type:'item.completed',item:{id:'answer',type:'agent_message',text:'Synthetic answer'}});
  if(fixture.scenario==='partial')process.exit(0);
  if(fixture.scenario==='partial_failure'){emit({type:'turn.failed',error:{message:'SYNTHETIC_PRIVATE_DIAGNOSTIC'}});process.exit(0);}
  emit({type:'turn.completed',usage:fixture.scenario==='missing_usage'?{}:fixture.scenario==='null_usage'?null:usage});
  if(fixture.scenario==='duplicate')emit({type:'turn.completed',usage});
  if(fixture.scenario==='late_exit')process.exit(9);
  process.exit(0);
 }else{
  if(fixture.scenario==='partial'){emit({type:'assistant',message:{role:'assistant',content:[{type:'text',text:'SYNTHETIC_PARTIAL_ONLY'}]},uuid:'partial',session_id:'synthetic-session',parent_tool_use_id:null});process.exit(0);}
  const failed=fixture.scenario==='failure';
  emit({type:'result',subtype:failed?'error_max_turns':'success',is_error:failed,errors:failed?['SYNTHETIC_PRIVATE_DIAGNOSTIC']:[],result:fixture.scenario==='empty'?'':'Synthetic answer',num_turns:1,duration_ms:1,duration_api_ms:1,uuid:'synthetic-response',session_id:'synthetic-session',total_cost_usd:fixture.scenario==='missing_usage'?undefined:0.012,modelUsage:fixture.scenario==='missing_usage'?{}:{'synthetic-model':{inputTokens:20,outputTokens:5,cacheReadInputTokens:7,cacheCreationInputTokens:3,thinkingTokens:2}}});
 }
}
if(fixture.provider==='codex'){
 let prompt='';process.stdin.on('data',chunk=>prompt+=chunk);process.stdin.on('end',()=>{log({type:'prompt',prompt});answer();});
}else{
 for await(const line of createInterface({input:process.stdin})){
  const message=JSON.parse(line);log({type:'input',message});
  if(message.type==='control_request')emit({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{commands:[],models:[],account:{}}}});
  else if(message.type==='user')answer();
 }
}
// Keep the hang fixture alive after stdin closes; the OS supervisor owns cleanup.
if(fixture.scenario==='hang')setInterval(()=>{},1000);
