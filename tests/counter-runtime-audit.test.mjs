import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

for(const file of ['staff/staff.js','display/display.js'])test(file+': stalled HTTP body is aborted, not left waiting forever',async()=>{
 const src=readFileSync(new URL('../public/'+file,import.meta.url),'utf8');
 const fn=src.split('\n').find(line=>line.startsWith('async function timedFetch('));
 let aborted=false;
 const context={AbortController,setTimeout:fn=>setTimeout(fn,10),clearTimeout,fetch:async(_url,{signal})=>{
  const wait=()=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('timeout'))}));
  return {ok:true,status:200,text:wait,json:wait};
 }};
 vm.createContext(context);vm.runInContext(fn+';globalThis.run=timedFetch',context);
 await assert.rejects(context.run('/api/test',{},12000),/timeout/);assert.equal(aborted,true);
});

test('Android fetch observer never changes display on background order GET',async()=>{
 const order='12345678-1234-1234-1234-123456789abc',calls=[];
 const context={URL,location:{origin:'https://audit.test',href:'https://audit.test/counter/'},localStorage:{getItem:()=> 'A'.repeat(43)},console,setInterval(){},fetch:async()=>new Response(JSON.stringify({ok:true,order:{id:order,paymentStatus:'PAID'}})),LotusNative:{displaySession(){},displayOrder:id=>calls.push(['display',id]),paymentRecorded:(...args)=>calls.push(['paid',...args])}};
 context.window=context;vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../android-counter/app/src/main/assets/hook.js',import.meta.url),'utf8'),context);
 await context.fetch('/api/staff/orders/'+order);assert.equal(calls.length,0);
 await context.fetch('/api/staff/orders/'+order+'/pay',{method:'POST'});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'paid');
});
