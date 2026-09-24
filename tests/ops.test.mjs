import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';

function setup(){
 const db=new DatabaseSync(':memory:');
 for(const n of ['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql'])db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 const DB={prepare(sql){let a=[];return{bind(...v){a=v;return this},async first(){return db.prepare(sql).get(...a)||null},async all(){return{results:db.prepare(sql).all(...a)}},async run(){return{meta:{changes:db.prepare(sql).run(...a).changes}}},_run(){return db.prepare(sql).run(...a)}}},async batch(stmts){db.exec('BEGIN');try{const r=stmts.map(x=>x._run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ASSETS:{fetch:async()=>new Response('',{status:404})},ORDERING_ENABLED:'true',SESSION_SECRET:'abcdefabcdefabcdefabcdefabcdefabcdef',POS_STAFF_PASSWORD:'654321',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'609271',BANK_ACCOUNT_NAME:'HUANG TIANSHENG'};
 const call=async(path,method='GET',data,token,extra={})=>{const headers={Origin:'https://pos.example',...extra};if(data!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;const r=await worker.fetch(new Request('https://pos.example'+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env);return{status:r.status,...await r.json()}};
 const login=async(username='huang',password='654321')=>{const r=await call('/api/staff/login','POST',{username,password});assert.equal(r.status,200,JSON.stringify(r));return r.token};
 const item=(qty=1)=>({productId:'101',qty,mods:{size:'中',spice:'中'}});
 const post=(path,value,token)=>call(path,'POST',value,token);
 return{db,env,call,login,item,post};
}

test('stock begins empty, QR/POS deduct atomically and cancellations return only tracked units',async()=>{
 const {db,call,login,item,post}=setup(),owner=await login();
 const order={table:'T01',items:[item(2)],idempotencyKey:'stock-order-aaaaaaaaaaaa'};
 assert.equal((await call('/api/catalog')).catalog.products.find(x=>x.id==='101').available,false);
 assert.equal((await post('/api/orders',order)).code,'OUT_OF_STOCK');
 const adjust=(target,id,quantity,kind='RECEIPT')=>post('/api/staff/inventory/adjust',{target,id,quantity,kind,reference:'Kiểm kê đầu ca',idempotencyKey:crypto.randomUUID()},owner);
 assert.equal((await adjust('PRODUCT','101',2)).status,200);
 assert.equal((await post('/api/orders',order)).code,'INGREDIENT_OUT_OF_STOCK');
 for(const ingredient of ['ING-PORK-HOCK','ING-DUCK','ING-CHICKEN','ING-RICE'])assert.equal((await adjust('INGREDIENT',ingredient,10000)).status,200);
 assert.equal((await call('/api/catalog')).catalog.products.find(x=>x.id==='101').available,true);
 const placed=await post('/api/orders',order);assert.equal(placed.status,201,JSON.stringify(placed));
 assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,0);
 assert.equal(db.prepare("SELECT stock FROM pos_ingredients WHERE id='ING-RICE'").get().stock,9500);
 assert.equal((await post('/api/orders',order)).duplicate,true);
 assert.equal((await post('/api/orders',{...order,idempotencyKey:'stock-order-bbbbbbbbbbbb'})).code,'OUT_OF_STOCK');
 const id=placed.order.id,accepted=await post('/api/staff/orders/'+id+'/accept',{version:1},owner);
 assert.equal(accepted.status,200);assert.equal(accepted.jobs.length,1);
 assert.equal((await post('/api/staff/orders/'+id+'/append',{version:accepted.order.version,items:[item()]},owner)).code,'OUT_OF_STOCK');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(id).n,1);
 const cancelled=await post('/api/staff/orders/'+id+'/cancel-unit',{version:accepted.order.version,index:0,reason:'Khách đổi món'},owner);
 assert.equal(cancelled.status,200,JSON.stringify(cancelled));assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,1);
 assert.equal(db.prepare("SELECT stock FROM pos_ingredients WHERE id='ING-RICE'").get().stock,9750);
 const append=await post('/api/staff/orders/'+id+'/append',{version:cancelled.order.version,items:[item()]},owner);
 assert.equal(append.status,200,JSON.stringify(append));assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,0);
 const closed=await post('/api/staff/orders/'+id+'/cancel',{version:append.order.version,reason:'Khách chưa ăn'},owner);
 assert.equal(closed.status,200,JSON.stringify(closed));assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,2);
 assert.equal(db.prepare("SELECT stock FROM pos_ingredients WHERE id='ING-RICE'").get().stock,10000);
 assert.equal((await post('/api/staff/orders/'+id+'/cancel',{version:append.order.version,reason:'Trùng'},owner)).status,409);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_inventory_movements WHERE order_id=?').get(id).n,20);
 db.close();
});

test('stock receipts and plans apply once; refunds cap paid amount, reverse points, and restock only with explicit selection',async()=>{
 const {db,call,login,item,post}=setup(),owner=await login();
 const adj=(target,id,quantity,kind='RECEIPT')=>post('/api/staff/inventory/adjust',{target,id,quantity,kind,reference:'Nhập từ phiếu 001',idempotencyKey:crypto.randomUUID()},owner);
 assert.equal((await adj('PRODUCT','101',4)).status,200);
 for(const ingredient of ['ING-PORK-HOCK','ING-DUCK','ING-CHICKEN','ING-RICE'])assert.equal((await adj('INGREDIENT',ingredient,10000)).status,200);
 const planned=await post('/api/staff/inventory/plans',{ingredientId:'ING-RICE',quantity:2000,dueDate:'2026-10-01',supplier:'Nhà gạo'},owner);
 assert.equal(planned.status,200);const plan=planned.plans.find(x=>x.status==='PLANNED');
 assert.equal((await post('/api/staff/inventory/plans/'+plan.id+'/receive',{},owner)).status,200);
 assert.equal((await post('/api/staff/inventory/plans/'+plan.id+'/receive',{},owner)).code,'PLAN_CHANGED');
 assert.equal((await adj('PRODUCT','101',100,'ADJUST_MINUS')).code,'STOCK_CANNOT_BE_NEGATIVE');
 const countId=crypto.randomUUID(),countBody={target:'PRODUCT',id:'101',quantity:1,kind:'RECEIPT',reference:'Mất ACK lần đầu',idempotencyKey:countId};
 assert.equal((await post('/api/staff/inventory/adjust',countBody,owner)).status,200);
 assert.equal((await post('/api/staff/inventory/adjust',countBody,owner)).status,200);
 assert.equal((await post('/api/staff/inventory/adjust',{...countBody,quantity:2},owner)).code,'REQUEST_ID_REUSED');
 assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,5);
 const member=await post('/api/member/register',{phone:'0912345678',name:'Khách đổi món',password:'member-test-password'});assert.equal(member.status,201);
 const saved=await post('/api/staff/orders',{table:'T01',items:[item(3)],memberId:member.member.id,idempotencyKey:'refund-order-aaaaaaaaaaaa'},owner);
 assert.equal(saved.status,201,JSON.stringify(saved));
 const paid=await post('/api/staff/orders/'+saved.order.id+'/pay',{version:saved.order.version,method:'BANK'},owner);assert.equal(paid.order.pointsEarned,39);
 const refund={orderId:saved.order.id,amount:30000,reason:'Hoàn một phần',method:'CASH',idempotencyKey:'refund_first_aaaaaaaaaaaa'};
 const first=await post('/api/staff/refunds',refund,owner);assert.equal(first.status,201,JSON.stringify(first));
 assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,2);
 assert.deepEqual([db.prepare('SELECT points,spend,orders FROM members WHERE id=?').get(member.member.id).points,db.prepare('SELECT points FROM loyalty_transactions WHERE order_id=?').get(saved.order.id).points],[36,36]);
 assert.equal((await post('/api/staff/refunds',refund,owner)).duplicate,true);
 assert.equal((await post('/api/staff/refunds',{...refund,idempotencyKey:'refund_over_aaaaaaaaaaaa',amount:400000},owner)).code,'REFUND_EXCEEDS_PAID');
 const full=await post('/api/staff/refunds',{...refund,amount:360000,reason:'Hàng còn nguyên',idempotencyKey:'refund_final_aaaaaaaaaaaa',restockItems:[{productId:'101',quantity:1}],confirmRestock:true},owner);
 assert.equal(full.status,201,JSON.stringify(full));
 assert.equal((await post('/api/staff/refunds',{...refund,amount:360000,reason:'Hàng còn nguyên',idempotencyKey:'refund_final_aaaaaaaaaaaa',restockItems:[{productId:'101',quantity:1}],confirmRestock:true},owner)).duplicate,true);
 assert.deepEqual(Object.values(db.prepare('SELECT points,spend,orders,last_visit FROM members WHERE id=?').get(member.member.id)),[0,0,0,null]);
 assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,3);
 assert.equal(db.prepare("SELECT stock FROM pos_ingredients WHERE id='ING-RICE'").get().stock,11500);
 assert.equal((await call('/api/staff/orders/'+saved.order.id,'GET',undefined,owner)).order.refundedAmount,390000);
 assert.equal((await post('/api/staff/refunds',{...refund,idempotencyKey:'refund_after_aaaaaaaaaaaa'},owner)).code,'REFUND_EXCEEDS_PAID');
 db.close();
});

test('split bill refund limits and server permissions survive forged staff requests',async()=>{
 const {db,call,login,item,post}=setup(),owner=await login();db.exec('UPDATE pos_product_inventory SET stock=100; UPDATE pos_ingredients SET stock=100000;');
 const add=await post('/api/staff/accounts',{username:'thu.ngan',name:'Thu ngân',role:'CASHIER',password:'cashier-strong-password'},owner);
 assert.equal(add.status,201,JSON.stringify(add));const cashier=await login('thu.ngan','cashier-strong-password');
 assert.equal((await post('/api/staff/inventory/adjust',{target:'PRODUCT',id:'101',quantity:1,kind:'RECEIPT',reference:'forged',idempotencyKey:crypto.randomUUID()},cashier)).status,403);
 assert.equal((await call('/api/staff/roles','GET',undefined,cashier)).status,403);
 const create=await post('/api/staff/orders',{table:'T02',items:[item(4)],idempotencyKey:'split_refund_aaaaaaaaaaaaa'},cashier);assert.equal(create.status,201);
 const split=await post('/api/staff/orders/'+create.order.id+'/split',{version:create.order.version,parts:Array.from({length:4},()=>[{index:0,qty:1}])},cashier);assert.equal(split.bills.length,4);
 for(const b of split.bills){const r=await post('/api/staff/bills/'+b.id+'/pay',{method:'CASH',received:b.total},cashier);assert.equal(r.status,200)}
 const base={orderId:create.order.id,amount:130000,reason:'Trả món',method:'CASH'};
 assert.equal((await post('/api/staff/refunds',{...base,billId:split.bills[0].id,idempotencyKey:'unauthorized_refund_aaaa'},cashier)).status,403);
 assert.equal((await post('/api/staff/refunds',{...base,idempotencyKey:'no_bill_refund_aaaaaaaa'},owner)).code,'REFUND_BILL_REQUIRED');
 assert.equal((await post('/api/staff/refunds',{...base,billId:split.bills[0].id,idempotencyKey:'bill_refund_first_aaaaaa'},owner)).status,201);
 assert.equal((await post('/api/staff/refunds',{...base,billId:split.bills[0].id,idempotencyKey:'bill_refund_again_aaaaaa'},owner)).code,'REFUND_EXCEEDS_BILL');
 assert.equal((await post('/api/staff/roles/CASHIER',{name:'Thu ngân chỉ xem',permissions:['ORDER_VIEW','INVENTORY_VIEW'],active:true},owner)).status,200);
 assert.equal((await post('/api/staff/orders',{table:'T03',items:[item()],idempotencyKey:'not_authorized_aaaaaaaaa'},cashier)).status,403);
 assert.equal((await call('/api/staff/inventory','GET',undefined,cashier)).status,200);
 assert.equal((await post('/api/staff/accounts/'+add.account.id,{name:'Đã nghỉ',role:'CASHIER',active:false},owner)).status,200);
 assert.equal((await call('/api/staff/orders','GET',undefined,cashier)).status,401);
 assert.equal((await post('/api/staff/roles/OWNER',{name:'Bad',permissions:[],active:false},owner)).status,403);
 db.close();
});

test('pre-migration orders keep their original stock accounting until an explicit append',async()=>{
 const {db,login,post,item}=setup(),owner=await login();
 const id=crypto.randomUUID(),time='2026-09-23T01:00:00.000Z',items=JSON.stringify([{productId:'101',qty:1,price:130000,name:'Cơm',mods:{size:'中',spice:'中'}}]);
 db.prepare("INSERT INTO qr_orders(id,idem_key,fingerprint,token_hash,code,table_id,items_json,subtotal,discount,total,status,payment_status,source,version,kitchen_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'ACCEPTED','UNPAID','QR',1,1,?,?)")
  .run(id,'legacy-key-'+id,'legacy-fingerprint','legacy-token','PT-260923-ABCD123456','T01',items,130000,0,130000,time,time);
 assert.equal(db.prepare('SELECT inventory_tracked FROM qr_orders WHERE id=?').get(id).inventory_tracked,0);
 const cancel=await post('/api/staff/orders/'+id+'/cancel',{version:1,reason:'Đơn cũ'},owner);
 assert.equal(cancel.status,200,JSON.stringify(cancel));assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_inventory_movements WHERE order_id=?').get(id).n,0);
 const id2=crypto.randomUUID();db.prepare("INSERT INTO qr_orders(id,idem_key,fingerprint,token_hash,code,table_id,items_json,subtotal,discount,total,status,payment_status,source,version,kitchen_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'ACCEPTED','UNPAID','QR',1,1,?,?)")
  .run(id2,'legacy-key-'+id2,'legacy-fingerprint','legacy-token','PT-260923-EFAB123456','T01',items,130000,0,130000,time,time);
 assert.equal((await post('/api/staff/orders/'+id2+'/append',{version:1,items:[item()]},owner)).code,'OUT_OF_STOCK');
 assert.equal(db.prepare('SELECT inventory_tracked,version FROM qr_orders WHERE id=?').get(id2).inventory_tracked,0);
 db.close();
});
