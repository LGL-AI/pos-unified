import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';

function system(){
 const db=new DatabaseSync(':memory:');for(const n of ['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql','0006_counter_display.sql','0007_counter_management.sql','0008_store_config.sql'])db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));db.exec('UPDATE pos_product_inventory SET stock=100; UPDATE pos_ingredients SET stock=100000;');
 const DB={prepare(sql){let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:db.prepare(sql).run(...args).changes}}},_run(){return db.prepare(sql).run(...args)}}},async batch(statements){db.exec('BEGIN');try{const v=statements.map(s=>s._run());db.exec('COMMIT');return v}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ASSETS:{fetch:async()=>new Response('',{status:404})},ORDERING_ENABLED:'true',SESSION_SECRET:'123456789012345678901234567890abcdef',POS_STAFF_PASSWORD:'long-staff-password-for-testing',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'12345678901',BANK_ACCOUNT_NAME:'PHAT TAI UAT'};
 const call=async(path,method='GET',value,token,headers={})=>{const h={Origin:'https://pos-qr.test',...headers};if(value!==undefined)h['Content-Type']='application/json';if(token)h.Authorization='Bearer '+token;const r=await worker.fetch(new Request('https://pos-qr.test'+path,{method,headers:h,body:value===undefined?undefined:JSON.stringify(value)}),env);return {status:r.status,...await r.json()}};
 const login=async()=>{const r=await call('/api/staff/login','POST',{password:env.POS_STAFF_PASSWORD});assert.equal(r.status,200,JSON.stringify(r));return r.token};
 const product=(qty=1)=>({productId:'101',qty,mods:{size:'中',spice:'中'}});
 return {db,env,call,login,product};
}

test('customer order reaches authenticated POS, accepting queues one kitchen ticket and adding queues only new items',async()=>{
 const {db,call,login,product}=system();const token=await login();
 assert.equal((await call('/api/staff/orders')).status,401);
 const q=await call('/api/orders','POST',{table:'T01',items:[product(2)],idempotencyKey:'qr_order_aaaaaaaaaaaaaaa'});
 assert.equal(q.status,201,JSON.stringify(q));assert.equal(q.order.total,260000);assert.equal(q.order.bankPayment.amount,260000);
 const id=q.order.id;const a=await call('/api/staff/orders/'+id+'/accept','POST',{version:1},token);
 assert.equal(a.order.status,'ACCEPTED');assert.equal(a.jobs.length,1);assert.equal(a.jobs[0].items[0].qty,2);
 assert.equal((await call('/api/staff/jobs/'+a.jobs[0].id+'/claim','POST',{},token)).status,'CLAIMED');
 assert.equal((await call('/api/staff/jobs/'+a.jobs[0].id+'/claim','POST',{},token)).status,409);
 assert.equal((await call('/api/staff/jobs/'+a.jobs[0].id+'/status','POST',{status:'SENT'},token)).status,'SENT');
 assert.equal((await call('/api/staff/orders/'+id+'/accept','POST',{version:1},token)).jobs.length,1);
 const add=await call('/api/staff/orders/'+id+'/append','POST',{version:a.order.version,items:[product(1)]},token);
 assert.equal(add.status,200,JSON.stringify(add));assert.equal(add.order.total,390000);assert.equal(add.jobs.length,2);assert.equal(add.jobs[1].kind,'ADD');assert.equal(add.jobs[1].items[0].qty,1);
 assert.equal((await call('/api/staff/orders/'+id+'/append','POST',{version:a.order.version,items:[product(1)]},token)).status,409);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs').get().n,2);
 const state=await call('/api/orders/'+id,'GET',undefined,undefined,{'x-order-token':q.orderToken});assert.equal(state.order.total,390000);
});

test('four units split into four bills, each paid once, parent transitions on final bill',async()=>{
 const {db,call,login,product}=system(),t=await login();const c=await call('/api/staff/orders','POST',{table:'T02',items:[product(4)],idempotencyKey:'staff_order_aaaaaaaaaaaaaa'},t);
 assert.equal(c.status,201,JSON.stringify(c));const o=c.order,id=o.id;
 const split=await call('/api/staff/orders/'+id+'/split','POST',{version:o.version,parts:[0,1,2,3].map(()=>[{index:0,qty:1}])},t);
 assert.equal(split.status,200,JSON.stringify(split));assert.equal(split.bills.length,4);assert.equal(split.bills.reduce((s,b)=>s+b.total,0),o.total);
 assert.equal((await call('/api/staff/orders/'+id+'/append','POST',{version:split.order.version,items:[product()]},t)).status,409);
 for(const b of split.bills.slice(0,3)){
  const paid=await call('/api/staff/bills/'+b.id+'/pay','POST',{method:'CASH',received:b.total},t);assert.equal(paid.status,200,JSON.stringify(paid));assert.notEqual(paid.order.paymentStatus,'PAID');
 }
 const last=await call('/api/staff/bills/'+split.bills[3].id+'/pay','POST',{method:'BANK'},t);
 assert.equal(last.order.paymentStatus,'PAID');assert.equal(last.order.status,'PAID');
 assert.equal((await call('/api/staff/bills/'+split.bills[3].id+'/pay','POST',{method:'BANK'},t)).status,409);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pos_bills WHERE payment_status='PAID'").get().n,4);
});

test('voucher quota is reserved once, released on cancellation and redeemed once on payment',async()=>{
 const {db,call,login,product}=system(),t=await login();
 db.prepare("UPDATE vouchers SET active=1,listed=1 WHERE code='SAVE20'").run();
 const create=async(key)=>call('/api/staff/orders','POST',{table:'T03',items:[product(2)],voucherCode:'SAVE20',idempotencyKey:key},t);
 const first=await create('staff_voucher_aaaaaaaaaaaa');assert.equal(first.status,201,JSON.stringify(first));assert.equal(first.order.total,240000);
 const duplicate=await create('staff_voucher_aaaaaaaaaaaa');assert.equal(duplicate.duplicate,true);
 assert.equal(db.prepare("SELECT reserved_count FROM vouchers WHERE code='SAVE20'").get().reserved_count,1);
 const cancel=await call('/api/staff/orders/'+first.order.id+'/cancel','POST',{version:first.order.version,reason:'Nhầm bàn'},t);
 assert.equal(cancel.status,200,JSON.stringify(cancel));assert.equal(db.prepare("SELECT reserved_count FROM vouchers WHERE code='SAVE20'").get().reserved_count,0);
 const next=await create('staff_voucher_bbbbbbbbbbbb');assert.equal(next.status,201);
 const paid=await call('/api/staff/orders/'+next.order.id+'/pay','POST',{version:next.order.version,method:'CASH',received:250000},t);
 assert.equal(paid.status,200,JSON.stringify(paid));assert.equal(db.prepare("SELECT reserved_count,redeemed_count FROM vouchers WHERE code='SAVE20'").get().redeemed_count,1);
 assert.equal((await call('/api/staff/orders/'+next.order.id+'/pay','POST',{version:next.order.version,method:'CASH',received:250000},t)).status,409);
});

test('unsafe splits, invalid cash and other origin do not mutate the order',async()=>{
 const {db,call,login,product}=system(),t=await login();const c=await call('/api/staff/orders','POST',{table:'T03',items:[product(4)],idempotencyKey:'staff_invalid_aaaaaaaaaaa'},t);
 const id=c.order.id,v=c.order.version;
 assert.equal((await call('/api/staff/orders/'+id+'/split','POST',{version:v,parts:[[{index:0,qty:1}],[{index:0,qty:2}]]},t)).status,400);
 assert.equal((await call('/api/staff/orders/'+id+'/split','POST',{version:v,parts:Array(5).fill([{index:0,qty:1}])},t)).status,400);
 assert.equal((await call('/api/staff/orders/'+id+'/pay','POST',{version:v,method:'CASH',received:1},t)).status,400);
 assert.equal((await call('/api/staff/orders/'+id+'/pay','POST',{version:v,method:'BANK'},t,{Origin:'https://evil.test'})).status,403);
 assert.equal(db.prepare('SELECT version FROM qr_orders WHERE id=?').get(id).version,v);
});

test('customer transfer report locks edits but staff can confirm bank payment after checking',async()=>{
 const {db,call,login,product}=system(),t=await login();
 const q=await call('/api/orders','POST',{table:'T04',items:[product()],idempotencyKey:'qr_report_aaaaaaaaaaaaaa'});
 const id=q.order.id,accepted=await call('/api/staff/orders/'+id+'/accept','POST',{version:q.order.version},t);
 const reported=await call('/api/orders/'+id+'/reported','POST',{},undefined,{'x-order-token':q.orderToken});
 assert.equal(reported.order.paymentStatus,'CUSTOMER_REPORTED');
 assert.equal((await call('/api/staff/orders/'+id+'/append','POST',{version:reported.order.version,items:[product()]},t)).status,409);
 const paid=await call('/api/staff/orders/'+id+'/pay','POST',{version:reported.order.version,method:'BANK'},t);
 assert.equal(paid.status,200,JSON.stringify(paid));assert.equal(paid.order.paymentStatus,'PAID');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(id).n,1);
});

test('split voucher discount stays exact and redeems only on last bill',async()=>{
 const {db,call,login,product}=system(),t=await login();
 db.prepare("UPDATE vouchers SET active=1,listed=1 WHERE code='SAVE20'").run();
 const c=await call('/api/staff/orders','POST',{table:'T05',items:[product(4)],voucherCode:'SAVE20',idempotencyKey:'staff_split_voucher_aaaaaaaa'},t);
 const s=await call('/api/staff/orders/'+c.order.id+'/split','POST',{version:c.order.version,parts:Array.from({length:4},()=>[{index:0,qty:1}])},t);
 assert.equal(s.bills.reduce((sum,b)=>sum+b.discount,0),20000);
 for(const b of s.bills.slice(0,3))await call('/api/staff/bills/'+b.id+'/pay','POST',{method:'CASH',received:b.total},t);
 assert.equal(db.prepare("SELECT reserved_count,redeemed_count FROM vouchers WHERE code='SAVE20'").get().redeemed_count,0);
 const last=s.bills[3];await call('/api/staff/bills/'+last.id+'/pay','POST',{method:'CASH',received:last.total},t);
 const v=db.prepare("SELECT reserved_count,redeemed_count FROM vouchers WHERE code='SAVE20'").get();assert.equal(v.reserved_count,0);assert.equal(v.redeemed_count,1);
});
