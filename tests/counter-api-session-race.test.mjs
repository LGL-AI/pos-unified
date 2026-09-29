import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};

test('old 401 cannot log out a newer counter session or show its error',async()=>{
  const old=deferred(),stored=new Map(),screen={innerHTML:'',querySelector(){return null}},connection={textContent:'',classList:{toggle(){}}};
  const document={body:{dataset:{mode:'handheld'}},querySelector(selector){return selector==='#app'?screen:selector==='#connection'?connection:null},addEventListener(){}};
  const context={document,localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},crypto:webcrypto,Intl,Date,Response,AbortController,console,setTimeout,clearTimeout};
  context.window=context;
  context.fetch=async(path,options={})=>{
    if(path==='/api/catalog')return json({ok:true,catalog:{products:[],store:{}}});
    if(path==='/api/staff/me')return options.headers.Authorization==='Bearer old-session'?old.promise:json({ok:true,staff:{id:'new-user',permissions:[]}});
    throw Error(`Unexpected route: ${path}`);
  };
  vm.createContext(context);
  const source=file('../public/staff/staff.js');
  vm.runInContext(source.replace(/\}\)\(\);\s*$/,`window.__audit={api,token(value){st.token=value;store.set('staff-session',value)},current:()=>st.token};})();`),context);
  await new Promise(setImmediate);
  context.__audit.token('old-session');
  const pending=context.__audit.api('GET','/api/staff/me');
  context.__audit.token('new-session');
  old.resolve(json({ok:false,code:'STAFF_LOGIN_REQUIRED'},401));
  await assert.rejects(pending,error=>error.code==='STALE_SESSION');
  assert.equal(context.__audit.current(),'new-session');
  assert.equal(stored.get('lotus-cloud:staff-session'),'new-session');
  assert.equal((await context.__audit.api('GET','/api/staff/me')).staff.id,'new-user');
});

test('native payment observer uses the token of the payment request',async()=>{
  const old=deferred(),tokens=new Map([['lotus-cloud:staff-session','old-session']]),paid=[];
  const context={location:{href:'https://pos.example/counter/',origin:'https://pos.example'},localStorage:{getItem:key=>tokens.get(key)||null},URL,console,setInterval(){},fetch:async()=>old.promise};
  context.window=context;context.LotusNative={displaySession(){},paymentRecorded(...args){paid.push(args)}};
  vm.createContext(context);
  vm.runInContext(file('../android-counter/app/src/main/assets/hook.js'),context);
  const id='12345678-1234-1234-1234-123456789abc';
  const waiting=context.fetch(`/api/staff/orders/${id}/pay`,{method:'POST'});
  tokens.set('lotus-cloud:staff-session','new-session');
  old.resolve(json({ok:true,order:{id,paymentStatus:'PAID'}}));
  await waiting;
  await new Promise(setImmediate);
  assert.deepEqual(paid,[]);
});
