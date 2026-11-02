import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('browser helper keeps CSRF in memory, scopes it to same-origin mutations and signs out',async()=>{
 const calls:Array<{url:string;options:any}>=[],redirects:string[]=[],elements:any[]=[];
 const element=()=>({textContent:'',children:[] as any[],onclick:undefined as undefined|(()=>Promise<void>),append(child:any){this.children.push(child);}});
 const document={createElement:element,body:{prepend(e:any){elements.push(e);}}};
 const window={location:{href:'http://127.0.0.1:3031/',origin:'http://127.0.0.1:3031',assign(path:string){redirects.push(path);}},fetch:async(url:any,options:any={})=>{calls.push({url:String(url),options});return {ok:true,status:200,json:async()=>({subject:'alice',tenant:'alpha',csrfToken:'test-csrf'})};}};
 runInNewContext(readFileSync(new URL('../public/browser-session.js',import.meta.url),'utf8'),{window,document,URL,Headers});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(elements.length,1);
 await window.fetch('/api/sessions/test/cancel',{method:'POST'});assert.equal(calls.at(-1)!.options.headers.get('X-CSRF-Token'),'test-csrf');
 await window.fetch('https://other.example/write',{method:'POST'});assert.equal(calls.at(-1)!.options.headers,undefined);
 await elements[0].children[0].onclick();assert.equal(calls.at(-1)!.url,'/auth/logout');assert.deepEqual(redirects,['/']);
});
