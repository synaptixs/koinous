export const GROK_STAGES=['startup','authentication','session-creation','inference'] as const;
export type GrokStage=typeof GROK_STAGES[number];
export type GrokProtocolTiming=Readonly<{version:1;elapsedMs:number;lastStage:GrokStage;stages:ReadonlyArray<Readonly<{stage:GrokStage;startedMs:number;durationMs:number;completed:boolean}>>}>;
// Client-observed ACP waits only. No provider-controlled strings or content enter this trace.
export class GrokTiming {
 private origin:number;private last=0;
 private rows:Array<{stage:GrokStage;startedMs:number;durationMs:number;completed:boolean}>=[{stage:'startup',startedMs:0,durationMs:0,completed:false}];
 private now:()=>number;
 constructor(now:()=>number=()=>performance.now()){this.now=now;this.origin=now();}
 private elapsed(){const n=this.now()-this.origin;if(Number.isFinite(n))this.last=Math.max(this.last,Math.min(2147483647,Math.max(0,Math.floor(n))));return this.last;}
 advance(stage:GrokStage){
  const index=GROK_STAGES.indexOf(stage);if(index!==this.rows.length||this.rows.length>=4)return;
  this.complete();this.rows.push({stage,startedMs:this.last,durationMs:0,completed:false});
 }
 complete(){const row=this.rows.at(-1)!;if(!row.completed){row.durationMs=this.elapsed()-row.startedMs;row.completed=true;}}
 snapshot():GrokProtocolTiming{
  const elapsedMs=this.elapsed();return Object.freeze({version:1,elapsedMs,lastStage:this.rows.at(-1)!.stage,
   stages:Object.freeze(this.rows.map(row=>Object.freeze({...row,durationMs:row.completed?row.durationMs:elapsedMs-row.startedMs})))});
 }
}
