import {applyCurrentSchema} from './helpers/schema.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/worker.js';

test('staff screen buttons create, append and split a four-unit order via the real API',async()=>{
 const db=new DatabaseSync(':memory:');applyCurrentSchema(db,{legacyMenu:true});db.exec('UPDATE pos_product_inventory SET stock=100; UPDATE pos_ingredients SET stock=100000;');
 const DB={prepare(sql){let a=[];return {bind(...v){a=v;return this},async first(){return db.prepare(sql).get(...a)||null},async all(){return{results:db.prepare(sql).all(...a)}},async run(){return{meta:{changes:db.prepare(sql).run(...a).changes}}},_run(){return db.prepare(sql).run(...a)}}},async batch(stmts){db.exec('BEGIN');try{const r=stmts.map(x=>x._run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ORDERING_ENABLED:'true',SESSION_SECRET:'test-secret-aabbccddeeff001122334455',POS_STAFF_PASSWORD:'local-staff-password-only-for-tests',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'12345678901',BANK_ACCOUNT_NAME:'PHAT TAI LOCAL'};
 const app={innerHTML:'',querySelector:()=>null},connection={textContent:'',classList:{toggle(){}}},listeners={},formInputs={'#order-note':{value:''},'#voucher':{value:''},'#split-count':{value:'4'}};
 const document={querySelector(s){return s==='#app'?app:s==='#connection'?connection:formInputs[s]||null},addEventListener(type,fn){listeners[type]=fn}};
 const storage=new Map(),context={document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto,Response,Request,URL,Intl,JSON,Number,Array,String,Math,Date,console,AbortSignal,setTimeout:(fn,ms)=>ms===7000?0:setTimeout(fn,ms),clearTimeout,confirm:()=>true,prompt:(label,defaultValue)=>defaultValue??'',navigator:{},fetch:async(path,opts={})=>worker.fetch(new Request('https://pos-qr.test'+path,{method:opts.method||'GET',headers:{Origin:'https://pos-qr.test',...opts.headers},body:opts.body}),env)};
 context.window=context;vm.createContext(context);vm.runInContext(readFileSync(new URL('../public/staff/qrcode.js',import.meta.url),'utf8'),context);vm.runInContext(readFileSync(new URL('../public/staff/staff.js',import.meta.url),'utf8'),context);
 async function click(dataset){await listeners.click({target:{closest:()=>({dataset,disabled:false})}})}
 await new Promise(r=>setTimeout(r,10));assert.match(app.innerHTML,/Đăng nhập Lotus POS Cloud/);
 await listeners.submit({target:{id:'login',password:{value:env.POS_STAFF_PASSWORD}},preventDefault(){}});assert.match(app.innerHTML,/Đơn hàng/);
 await click({screen:'new'});assert.match(app.innerHTML,/Thực đơn/);
 listeners.input({target:{id:'order-note',value:'Không hành'}});
 await click({add:'101'});assert.match(app.innerHTML,/Không hành/);
 for(let n=0;n<3;n++)await click({cartQty:'0',delta:'1'});
 assert.match(app.innerHTML,/Giỏ món \(4\)/);
 await click({action:'submit'});
 let row=db.prepare('SELECT id,total,status,note FROM qr_orders').get();assert.equal(row.total,520000);assert.equal(row.status,'ACCEPTED');assert.equal(row.note,'Không hành');assert.match(app.innerHTML,/Phiếu bếp/);
 await click({action:'append'});await click({add:'112'});await click({action:'submit'});
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs').get().n,0);
 assert.equal(db.prepare('SELECT total FROM qr_orders').get().total,585000);
 // The split unit picker contains five units; four bills satisfy the original rule.
 await click({action:'split'});await click({action:'split-prepare'});assert.match(app.innerHTML,/Xác nhận tách bill/);
 await click({action:'split-confirm'});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_bills').get().n,4);
 assert.equal(db.prepare('SELECT SUM(total) AS n FROM pos_bills').get().n,585000);
 assert.match(app.innerHTML,/Bill 4/);
 db.close();
});
