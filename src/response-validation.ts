export type ValidationIssue={path:string;code:'too_long'|'too_many_items'|'invalid_type'|'invalid_value'|'missing_field'|'unknown_fields'|'duplicate'|'invalid_json';message:string;actual?:number;limit?:number;excess?:number};
export type ResponseValidation={version:1;status:'valid'|'invalid';issues:ValidationIssue[];lengthUnit:'utf16-code-units'};

// These checks are used by the canonical parsers, not by a separate UI validator.
// Length means JavaScript string.length, preserving the existing UTF-16 limits.
export class ResponseValidator {
 private start:number;
 issues:ValidationIssue[];
 constructor(issues:ValidationIssue[]=[]){this.issues=issues;this.start=issues.length;}
 get valid(){return this.issues.length===this.start;}
 issue(path:string,code:ValidationIssue['code'],message:string,counts?:{actual:number;limit:number}){
  this.issues.push({path,code,message,...counts,...(counts?{excess:Math.max(0,counts.actual-counts.limit)}:{})});
 }
 text(value:unknown,path:string,max:number):value is string {
  if(typeof value!=='string'){this.issue(path,'invalid_type',`${path}: expected text.`);return false;}
  let valid=true;
  if(!value.trim()){this.issue(path,'invalid_value',`${path}: text must not be empty.`);valid=false;}
  if(value.length>max){this.issue(path,'too_long',`${path}: ${value.length} characters; limit ${max}; ${value.length-max} over.`,{actual:value.length,limit:max});valid=false;}
  return valid;
 }
 array(value:unknown,path:string,max:number):value is any[] {
  if(!Array.isArray(value)){this.issue(path,'invalid_type',`${path}: expected an array.`);return false;}
  if(value.length>max){this.issue(path,'too_many_items',`${path}: ${value.length} items; limit ${max}.`,{actual:value.length,limit:max});return false;}
  return true;
 }
 record(value:unknown,path:string,required:string[],optional:string[]=[]):value is Record<string,any> {
  if(!value||typeof value!=='object'||Array.isArray(value)){this.issue(path,'invalid_type',`${path}: expected an object.`);return false;}
  for(const key of required)if(!Object.hasOwn(value,key))this.issue(path==='response'?key:`${path}.${key}`,'missing_field',`${path}: required field ${key} is missing.`);
  if(Object.keys(value).some(k=>![...required,...optional].includes(k)))this.issue(path,'unknown_fields',`${path}: unexpected fields are not permitted.`);
  return true;
 }
 choice(value:unknown,path:string,choices:readonly string[]){
  if(typeof value!=='string'||!choices.includes(value))this.issue(path,'invalid_value',`${path}: expected one of ${choices.join(', ')}.`);
 }
 strings(value:unknown,path:string,maxItems:number,maxChars:number){
  if(this.array(value,path,maxItems))value.forEach((x,i)=>this.text(x,`${path}[${i}]`,maxChars));
 }
 json(text:string,max:number):unknown {
  if(text.length>max){this.issue('response','too_long',`response: ${text.length} characters; limit ${max}; ${text.length-max} over.`,{actual:text.length,limit:max});return null;}
  try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/,'$1'));}
  catch{this.issue('response','invalid_json','response: invalid JSON; the original response is preserved.');return null;}
 }
}
