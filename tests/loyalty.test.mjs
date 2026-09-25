import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';

function setup(){
 const db=new DatabaseSync(':memory:');
 for(const n of ['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql','0006_counter_display.sql','0007_counter_management.sql','0008_store_config.sql'])db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));db.exec('UPDATE pos_product_inventory SET stock=100; UPDATE pos_ingredients SET stock=100000;');
 const DB={prepare(sql){let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:db.prepare(sql).run(...args).changes}}},_run(){return db.prepare(sql).run(...args)}}},async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>s._run());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ASSETS:{fetch:async()=>new Response('',{status:404})},ORDERING_ENABLED:'true',SESSION_SECRET:'loyalty-test-secret-0123456789abcdef0123456789',POS_STAFF_PASSWORD:'654321',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'609271',BANK_ACCOUNT_NAME:'HUANG TIANSHENG'};
 const send=async(path,method='GET',data,headers={})=>{const h={Origin:'https://pos-unified.test',...headers};if(data!==undefined)h['Content-Type']='application/json';const response=await worker.fetch(new Request('https://pos-unified.test'+path,{method,headers:h,body:data===undefined?undefined:JSON.stringify(data)}),env);return{status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}};
 return {db,env,send};
}

test('member earns only on staff-confirmed QR payment; voucher reduces points and six-digit POS password works',async()=>{
 const {db,send}=setup();
 const t=await send('/api/staff/login','POST',{password:'654321'});assert.equal(t.status,200);
 const auth={Authorization:'Bearer '+t.data.token};
 const m=await send('/api/member/register','POST',{phone:'0912345678',name:'Kiểm tra điểm',password:'member-test-password'});assert.equal(m.status,201);
 const id=m.data.member.id,cookie={Cookie:m.cookie};
 db.prepare('UPDATE members SET points=90,spend=450000,orders=2 WHERE id=?').run(id);
 db.prepare("UPDATE vouchers SET active=1,listed=1 WHERE code='SAVE20'").run();
 const q=await send('/api/orders','POST',{table:'T01',items:[{productId:'101',qty:2,mods:{size:'中',spice:'中'}}],voucherCode:'SAVE20',idempotencyKey:'loyalty_qr_aaaaaaaaaaaaaaa'},cookie);
 assert.equal(q.status,201,JSON.stringify(q.data));assert.equal(q.data.order.total,240000);assert.equal(q.data.order.bankPayment.account,'609271');assert.equal(q.data.order.bankPayment.accountName,'HUANG TIANSHENG');
 const ledger=()=>db.prepare('SELECT * FROM loyalty_transactions ORDER BY paid_at').all();
 const profile=()=>db.prepare('SELECT points,spend,orders,last_visit FROM members WHERE id=?').get(id);
 assert.equal(ledger().length,0);
 const accepted=await send('/api/staff/orders/'+q.data.order.id+'/accept','POST',{version:q.data.order.version},auth);
 const reported=await send('/api/orders/'+q.data.order.id+'/reported','POST',{}, {'x-order-token':q.data.orderToken});assert.equal(reported.data.order.paymentStatus,'CUSTOMER_REPORTED');assert.equal(profile().points,90);assert.equal(ledger().length,0);
 const paid=await send('/api/staff/orders/'+q.data.order.id+'/pay','POST',{version:reported.data.order.version,method:'BANK'},auth);
 assert.equal(paid.status,200,JSON.stringify(paid.data));assert.equal(paid.data.order.pointsEarned,24);
 assert.deepEqual([profile().points,profile().spend,profile().orders],[114,690000,3]);assert.equal(profile().last_visit.length,10);
 assert.equal(ledger()[0].order_id,q.data.order.id);assert.equal(ledger()[0].points,24);
 assert.equal((await send('/api/staff/orders/'+q.data.order.id+'/pay','POST',{version:reported.data.order.version,method:'BANK'},auth)).status,409);
 assert.equal(ledger().length,1);
 const me=await send('/api/member/me','GET',undefined,cookie);assert.equal(me.data.member.tier,'Silver');assert.equal(me.data.member.pointsSynced,true);
 assert.equal((await send('/api/member/loyalty')).status,401);
 const history=await send('/api/member/loyalty','GET',undefined,cookie);assert.equal(history.data.transactions.length,1);assert.deepEqual([history.data.transactions[0].points,history.data.transactions[0].amount],[24,240000]);
 assert.equal(accepted.data.jobs.length,1);
});

test('four-way split earns parent-order points once after final bill; guest gets none',async()=>{
 const {db,send}=setup();const staff=await send('/api/staff/login','POST',{password:'654321'}),auth={Authorization:'Bearer '+staff.data.token};
 const m=await send('/api/member/register','POST',{phone:'0998765432',name:'Split Test',password:'member-test-password'});const memberId=m.data.member.id;
 const order=await send('/api/staff/orders','POST',{table:'T02',items:[{productId:'101',qty:4,mods:{size:'中',spice:'中'}}],memberId,idempotencyKey:'loyalty_split_aaaaaaaaaaaaa'},auth);assert.equal(order.status,201,JSON.stringify(order.data));
 const split=await send('/api/staff/orders/'+order.data.order.id+'/split','POST',{version:order.data.order.version,parts:Array.from({length:4},()=>[{index:0,qty:1}])},auth);assert.equal(split.status,200);
 const member=()=>db.prepare('SELECT points,spend,orders FROM members WHERE id=?').get(memberId);
 for(const bill of split.data.bills.slice(0,3)){const done=await send('/api/staff/bills/'+bill.id+'/pay','POST',{method:'CASH',received:bill.total},auth);assert.equal(done.status,200);assert.equal(member().points,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loyalty_transactions').get().n,0)}
 const bill=split.data.bills[3];const last=await send('/api/staff/bills/'+bill.id+'/pay','POST',{method:'BANK'},auth);assert.equal(last.status,200);assert.equal(last.data.order.pointsEarned,52);
 assert.deepEqual([member().points,member().spend,member().orders],[52,520000,1]);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loyalty_transactions').get().n,1);
 assert.equal((await send('/api/staff/bills/'+bill.id+'/pay','POST',{method:'BANK'},auth)).status,409);
 db.prepare("UPDATE qr_orders SET payment_status='PAID' WHERE id=?").run(order.data.order.id);assert.equal(member().points,52);
 const guest=await send('/api/staff/orders','POST',{table:'T03',items:[{productId:'101',qty:1,mods:{size:'中',spice:'中'}}],idempotencyKey:'loyalty_guest_aaaaaaaaaaaaa'},auth);
 await send('/api/staff/orders/'+guest.data.order.id+'/pay','POST',{version:guest.data.order.version,method:'CASH',received:130000},auth);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loyalty_transactions').get().n,1);
});

test('Worker keeps ordering unavailable until loyalty migration is installed',async()=>{
 const {env}=setup();const disabled={...env,DB:{prepare(sql){if(sql.includes('loyalty_transactions'))throw Error('missing table');return env.DB.prepare(sql)}}};
 const response=await worker.fetch(new Request('https://pos-unified.test/api/health'),disabled);const data=await response.json();assert.equal(data.acceptingOrders,false);assert.equal(data.d1,'unavailable');
});
