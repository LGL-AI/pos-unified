import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import worker from '../src/worker.js';
import {applyCurrentSchema} from './helpers/schema.mjs';

function fixture(){
 const db=new DatabaseSync(':memory:');applyCurrentSchema(db);
 const DB={prepare(sql){let values=[];return{bind(...args){values=args;return this},async first(){return db.prepare(sql).get(...values)||null},async all(){return{results:db.prepare(sql).all(...values)}},async run(){return{meta:db.prepare(sql).run(...values)}}}}};
 const env={DB,ASSETS:{fetch:async()=>new Response('not found',{status:404})},ORDERING_ENABLED:'true',SESSION_SECRET:'qr-tables-local-secret-0123456789abcdef01234567',POS_STAFF_PASSWORD:'local-qr-test-owner'};
 const raw=(path,opts={})=>worker.fetch(new Request('https://pos.test'+path,{method:opts.method||'GET',headers:{Origin:'https://pos.test',...opts.headers},body:opts.body}),env);
 const call=async(path,method='GET',data,headers={})=>{const res=await raw(path,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers},body:data===undefined?undefined:JSON.stringify(data)});return{status:res.status,...await res.json()}};
 return{db,env,raw,call};
}
const item={productId:'EC_MAIN001',qty:1};
const order=(table,key)=>({table,items:[item],idempotencyKey:key});

test('QR visit records table on D1 and staff receives orders for the same two tables',async()=>{
 const f=fixture();
 const a=await f.call('/api/qr/visit?table=T01','POST',{table:'T01'});
 const b=await f.call('/api/qr/visit?table=T02','POST',{table:'T02'});
 assert.equal(a.status,200);assert.equal(a.table,'T01');assert.equal(b.table,'T02');
 await f.call('/api/qr/visit?table=T01','POST',{table:'T01'});
 assert.deepEqual(f.db.prepare('SELECT table_id,views FROM qr_table_visits ORDER BY table_id').all().map(x=>({...x})),[{table_id:'T01',views:2},{table_id:'T02',views:1}]);
 const first=await f.call('/api/orders?table=T01','POST',order('T01','qr-table-01-unique-order'));
 const second=await f.call('/api/orders?table=T02','POST',order('T02','qr-table-02-unique-order'));
 assert.equal(first.status,201);assert.equal(second.status,201);
 assert.deepEqual(f.db.prepare('SELECT table_id FROM qr_orders ORDER BY table_id').all().map(x=>x.table_id),['T01','T02']);
 const auth=await f.call('/api/staff/login','POST',{username:'huang',password:f.env.POS_STAFF_PASSWORD});
 assert.equal(auth.status,200);
 const staff=await f.call('/api/staff/orders','GET',undefined,{Authorization:'Bearer '+auth.token});
 assert.equal(staff.status,200);assert.deepEqual(new Set(staff.orders.map(x=>x.table)),new Set(['T01','T02']));
 f.db.close();
});

test('QR link table cannot be changed by another form value or out of range',async()=>{
 const f=fixture();f.db.exec('UPDATE pos_store_config SET table_count=2 WHERE id=1');
 const wrong=await f.call('/api/qr/visit?table=T02','POST',{table:'T01'});
 assert.equal(wrong.status,400);assert.equal(wrong.code,'QR_TABLE_MISMATCH');
 const removed=await f.call('/api/qr/visit?table=T03','POST',{table:'T03'});
 assert.equal(removed.status,400);assert.equal(removed.code,'INVALID_TABLE');
 const orderWrong=await f.call('/api/orders?table=T02','POST',order('T01','qr-table-mismatch-order01'));
 assert.equal(orderWrong.status,400);assert.equal(orderWrong.code,'QR_TABLE_MISMATCH');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qr_orders').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qr_table_visits').get().n,0);
 f.db.close();
});

test('customer QR UI keeps the scanned table, even when a different table was saved before',async()=>{
 const f=fixture(),storage=new Map([['lotus-qr-table','T01']]),listeners={},app={innerHTML:''};
 const document={documentElement:{lang:'vi'},body:{style:{},appendChild(){}},hidden:false,querySelector:s=>s==='#app'?app:null,querySelectorAll:()=>[],addEventListener:(k,fn)=>listeners[k]=fn,createElement:()=>({setAttribute(){},appendChild(){},remove(){}})};
 const context={document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},location:{search:'?table=T02',href:'https://pos.test/qr/?table=T02'},history:{replaceState(){}},navigator:{onLine:true},crypto,Response,Request,URL,URLSearchParams,Intl,JSON,Number,Array,String,Math,Date,console,AbortSignal,AbortController,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,fetch:f.raw};
 context.window=context;context.addEventListener=()=>{};context.scrollTo=()=>{};vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../public/assets/qrcode.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8'),context);
 for(let i=0;i<100&&!app.innerHTML.includes('data-add="EC_MAIN001"');i++)await new Promise(r=>setTimeout(r,5));
 assert.match(app.innerHTML,/Bàn.*T02/s);assert.doesNotMatch(app.innerHTML,/data-action="table"/);
 const click=dataset=>listeners.click({target:{closest:()=>({dataset})}});
 click({action:'table'});click({pick:'T01'});
 assert.doesNotMatch(app.innerHTML,/data-action="confirm-table"/);
 click({add:'EC_MAIN001'});click({action:'modal-save'});click({view:'cart'});click({action:'submit'});
 for(let i=0;i<100&&!f.db.prepare('SELECT table_id FROM qr_orders').get();i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(f.db.prepare('SELECT table_id FROM qr_orders').get()?.table_id,'T02');
 assert.equal(f.db.prepare('SELECT table_id FROM qr_table_visits').get()?.table_id,'T02');
 f.db.close();
});

test('exported table QR files contain the ordering URL and table number',()=>{
 const dest=mkdtempSync(join(tmpdir(),'lotus-table-qr-'));
 try{
  execFileSync(process.execPath,[new URL('../scripts/generate-table-qr.mjs',import.meta.url).pathname,'--origin','https://pos.test','--tables','2','--out',dest]);
  assert.match(readFileSync(join(dest,'links.csv'),'utf8'),/T01,https:\/\/pos\.test\/qr\/\?table=T01,T01\.svg/);
  assert.match(readFileSync(join(dest,'links.csv'),'utf8'),/T02,https:\/\/pos\.test\/qr\/\?table=T02,T02\.svg/);
  assert.match(readFileSync(join(dest,'T02.svg'),'utf8'),/GỌI MÓN · BÀN T02/);
 }finally{rmSync(dest,{recursive:true,force:true})}
});
