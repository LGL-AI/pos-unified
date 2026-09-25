import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/worker.js';

test('customer order screen renders real bank QR, saves PNG and reports transfer without marking PAID',async()=>{
 const db=new DatabaseSync(':memory:');for(const n of ['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql','0006_counter_display.sql','0007_counter_management.sql','0008_store_config.sql'])db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));db.exec('UPDATE pos_product_inventory SET stock=100; UPDATE pos_ingredients SET stock=100000;');
 const DB={prepare(sql){let a=[];return {bind(...v){a=v;return this},async first(){return db.prepare(sql).get(...a)||null},async all(){return{results:db.prepare(sql).all(...a)}},async run(){return{meta:{changes:db.prepare(sql).run(...a).changes}}}}}};
 const env={DB,ORDERING_ENABLED:'true',SESSION_SECRET:'test-secret-aabbccddeeff001122334455',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'12345678901',BANK_ACCOUNT_NAME:'PHAT TAI LOCAL'};
 const call=(path,opts={})=>worker.fetch(new Request('https://pos-qr.test'+path,{method:opts.method||'GET',headers:{Origin:'https://pos-qr.test',...opts.headers},body:opts.body}),env);
 const order=await (await call('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'T01',idempotencyKey:'customer_screen_aaaaaaaaaaa',items:[{productId:'101',qty:1}]})})).json();assert.equal(order.ok,true,JSON.stringify(order));
 const storage=new Map([['lotus-qr-order:T01',JSON.stringify({order:order.order,token:order.orderToken})]]),listeners={},app={innerHTML:''},downloads=[];
 const document={documentElement:{lang:'vi'},body:{style:{},appendChild(){}},querySelector:s=>s==='#app'?app:null,addEventListener:(name,fn)=>{listeners[name]=fn},createElement:type=>type==='canvas'?{width:0,height:0,getContext(){return{fillRect(){},fillText(){}}},toDataURL:()=> 'data:image/png;base64,ZmFrZQ=='}:{download:'',href:'',click(){downloads.push(this.download)},remove(){}}};
 const context={window:null,document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},location:{search:'?table=T01',href:'https://pos-qr.test/?table=T01'},history:{replaceState(){}},navigator:{onLine:true,clipboard:{writeText:async()=>{}}},crypto,Response,Request,URL,URLSearchParams,Intl,JSON,Number,Array,String,Math,Date,console,AbortSignal,setTimeout:(fn,ms)=>0,clearTimeout,setInterval:()=>0,fetch:call};
 context.window=context;context.scrollTo=()=>{};context.addEventListener=()=>{};vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../public/assets/qrcode.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8'),context);
 await new Promise(r=>setTimeout(r,12));
 function click(dataset){listeners.click({target:{closest:()=>({dataset})}})}
 click({view:'orders'});await new Promise(r=>setTimeout(r,12));
 assert.match(app.innerHTML,/609271/);assert.match(app.innerHTML,/payment-qr-svg/);assert.match(app.innerHTML,/Tải QR PNG/);
 click({action:'payment-download'});assert.equal(downloads.length,1);assert.match(downloads[0],/PhatTai_QR_/);
 click({action:'payment-reported'});await new Promise(r=>setTimeout(r,15));
 assert.equal(db.prepare('SELECT payment_status FROM qr_orders WHERE id=?').get(order.order.id).payment_status,'CUSTOMER_REPORTED');
 assert.match(app.innerHTML,/Đã báo nhân viên/);
 db.close();
});
