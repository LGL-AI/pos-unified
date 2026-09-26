import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';

function fixture(){
 const db=new DatabaseSync(':memory:');for(const n of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){return {meta:{changes:db.prepare(sql).run(...args).changes}}},_run(){return db.prepare(sql).run(...args)}}},async batch(statements){db.exec('BEGIN');try{const x=statements.map(s=>s._run());db.exec('COMMIT');return x}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ASSETS:{fetch:async()=>new Response('not found',{status:404})},ORDERING_ENABLED:'true',SESSION_SECRET:'local-secret-0123456789-0123456789-0123456789',POS_STAFF_PASSWORD:'local-test-password',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'12345678901',BANK_ACCOUNT_NAME:'ECHO TEST'};
 const request=async(path,method='GET',body,token,headers={})=>{const h={Origin:'https://pos-qr.test',...headers};if(body!==undefined)h['Content-Type']='application/json';if(token)h.Authorization='Bearer '+token;const r=await worker.fetch(new Request('https://pos-qr.test'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:r.status,headers:r.headers,...await r.json()}};
 return {db,env,request};
}
const item=(qty=1)=>({productId:'EC_MAIN001',qty,mods:{size:'中',spice:'中'}});

test('QR creates a service alert but only staff confirmation creates a kitchen job',async()=>{
 const {db,request}=fixture(),auth=await request('/api/staff/login','POST',{password:'local-test-password'});assert.equal(auth.status,200,JSON.stringify(auth));const token=auth.token;
 const order=await request('/api/orders','POST',{table:'T01',items:[item()],idempotencyKey:'payment_first_order_001'});assert.equal(order.status,201,JSON.stringify(order));const id=order.order.id;
 assert.match(order.order.code,/^\d{8}-\d{4}-[0-9A-F]{6}-CK$/);assert.equal(order.order.bankPayment.content,order.order.code);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs').get().n,0);
 assert.equal((await request('/api/orders/'+id+'/reported','POST',{},undefined,{'x-order-token':order.orderToken})).status,404);
 assert.equal((await request('/api/orders/'+id+'/service','POST',{},undefined,{'x-order-token':order.orderToken})).status,200);
 assert.equal((await request('/api/orders/'+id+'/service','POST',{},undefined,{'x-order-token':order.orderToken})).status,200);
 assert.equal((await request('/api/staff/service-requests','GET',undefined,token)).requests.length,1);
 const accepted=await request('/api/staff/orders/'+id+'/accept','POST',{version:order.order.version},token);assert.equal(accepted.jobs.length,0);
 const paid=await request('/api/staff/orders/'+id+'/pay','POST',{version:accepted.order.version,method:'BANK'},token);assert.equal(paid.status,200,JSON.stringify(paid));assert.equal(paid.jobs.length,1);
 assert.equal(paid.jobs[0].items[0].qty,1);assert.equal(paid.order.code,order.order.code);
 assert.equal((await request('/api/staff/service-requests','GET',undefined,token)).requests.length,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(id).n,1);
});

test('QR cash choice survives reload, requests table service, and kitchen waits for payment',async()=>{
 const {db,request}=fixture(),auth=await request('/api/staff/login','POST',{password:'local-test-password'}),token=auth.token;
 const store=await request('/api/catalog');assert.equal(store.catalog.store.feedbackUrl,'https://forms.gle/Fpd7b7PdQV9kPBpf7');assert.equal('invoiceUrl' in store.catalog.store,false);
 const payload={table:'T04',items:[item()],paymentPreference:'CASH',idempotencyKey:'qr_cash_service_abcdef12345'};
 const created=await request('/api/orders','POST',payload);assert.equal(created.status,201,JSON.stringify(created));assert.equal(created.order.paymentPreference,'CASH');assert.equal(created.order.paymentStatus,'UNPAID');assert.match(created.order.code,/-TM$/);assert.equal(created.order.bankPayment.content,created.order.code.replace(/-TM$/,'-CK'));
 const again=await request('/api/orders','POST',payload);assert.equal(again.duplicate,true);
 const changed=await request('/api/orders','POST',{...payload,paymentPreference:'BANK'});assert.equal(changed.status,409);
 const id=created.order.id,headers={'x-order-token':created.orderToken};
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(id).n,0);
 const notify=await request('/api/orders/'+id+'/service','POST',{},undefined,headers);assert.equal(notify.status,200);
 const restored=await request('/api/orders/'+id,'GET',undefined,undefined,headers);assert.equal(restored.order.serviceRequested,true);assert.equal(restored.order.paymentStatus,'UNPAID');
 assert.equal((await request('/api/staff/service-requests','GET',undefined,token)).requests.length,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(id).n,0);
 const accepted=await request('/api/staff/orders/'+id+'/accept','POST',{version:created.order.version},token);assert.equal(accepted.status,200);assert.equal(accepted.jobs.length,0);
 const paid=await request('/api/staff/orders/'+id+'/pay','POST',{version:accepted.order.version,method:'CASH',received:created.order.total},token);assert.equal(paid.status,200,JSON.stringify(paid));assert.equal(paid.jobs.length,1);assert.match(paid.order.code,/-TM$/);
 const final=await request('/api/orders/'+id,'GET',undefined,undefined,headers);assert.equal(final.order.paymentStatus,'PAID');assert.equal(final.order.serviceRequested,true);
});

test('cash order suffix, refund lookup and member phone password limits',async()=>{
 const {db,request}=fixture(),auth=await request('/api/staff/login','POST',{password:'local-test-password'});assert.equal(auth.status,200);const token=auth.token;
 const reg=await request('/api/member/register','POST',{phone:'09123456789',name:'Khách thử',password:'ignored'});assert.equal(reg.status,201,JSON.stringify(reg));
 assert.equal((await request('/api/member/login','POST',{phone:'09123456789',password:'09123456789'})).status,200);
 assert.equal((await request('/api/member/register','POST',{phone:'091234567',name:'Quá ngắn'})).status,400);
 assert.equal((await request('/api/member/register','POST',{phone:'091234567890',name:'Quá dài'})).status,400);
 const cookie=reg.headers.get('set-cookie').split(';')[0];assert.equal((await request('/api/member/password','POST',{currentPassword:'09123456789',newPassword:'123456789012'},undefined,{Cookie:cookie})).status,400);
 const change=await request('/api/member/password','POST',{currentPassword:'09123456789',newPassword:'newpass2026'},undefined,{Cookie:cookie});assert.equal(change.status,200,JSON.stringify(change));
 assert.equal((await request('/api/member/login','POST',{phone:'09123456789',password:'09123456789'})).status,401);
 assert.equal((await request('/api/member/login','POST',{phone:'09123456789',password:'newpass2026'})).status,200);
 const draft=await request('/api/staff/orders','POST',{table:'T02',items:[item()],idempotencyKey:'cash_order_001_abcdef123456'},token);assert.equal(draft.status,201,JSON.stringify(draft));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs').get().n,0);
 const cash=await request('/api/staff/orders/'+draft.order.id+'/pay','POST',{version:draft.order.version,method:'CASH',received:draft.order.total},token);assert.equal(cash.status,200,JSON.stringify(cash));assert.match(cash.order.code,/-TM$/);assert.equal(cash.jobs.length,1);
 const alias=cash.order.code.replace(/-TM$/,'-CK');assert.equal((await request('/api/staff/orders?code='+alias,'GET',undefined,token)).orders[0].id,cash.order.id);
 assert.equal((await request('/api/staff/orders?code='+cash.order.code,'GET',undefined,token)).orders[0].id,cash.order.id);
});

test('returned and compensated items appear with on-duty staff; refund retry is idempotent',async()=>{
 const {db,request}=fixture(),auth=await request('/api/staff/login','POST',{password:'local-test-password'});assert.equal(auth.status,200);const token=auth.token;
 const draft=await request('/api/staff/orders','POST',{table:'T03',items:[item(2)],idempotencyKey:'refund_order_test_abcdef1234'},token);assert.equal(draft.status,201);
 const paid=await request('/api/staff/orders/'+draft.order.id+'/pay','POST',{version:draft.order.version,method:'CASH',received:draft.order.total},token);assert.equal(paid.status,200);
 const attendee=auth.staff.id,time=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 db.prepare("INSERT INTO pos_attendance(id,staff_id,work_date,clock_in,status) VALUES(?,?,?,?,'OPEN')").run(crypto.randomUUID(),attendee,day,new Date(Date.now()-60_000).toISOString());
 const payload={orderId:draft.order.id,amount:55000,reason:'Sản phẩm bị trả',method:'CASH',idempotencyKey:'refund_return_test_abcdef1234',lineItems:[{productId:'EC_MAIN001',quantity:1,amount:55000,category:'RETURNED'}]};
 const refund=await request('/api/staff/refunds','POST',payload,token);assert.equal(refund.status,201,JSON.stringify(refund));
 const repeat=await request('/api/staff/refunds','POST',payload,token);assert.equal(repeat.status,200,JSON.stringify(repeat));assert.equal(repeat.duplicate,true);
 const report=await request('/api/staff/reports/analytics?date='+day,'GET',undefined,token);assert.equal(report.status,200,JSON.stringify(report));
 const details=report.analytics.refundDetails;assert.equal(details.length,1);assert.equal(details[0].category,'RETURNED');assert.equal(details[0].productName,'Gà giòn 2 miếng');assert.equal(details[0].quantity,1);assert.equal(details[0].itemAmount,55000);assert.ok(details[0].onDuty,JSON.stringify(details));
});

test('split order releases one kitchen ticket only after the final bill is paid',async()=>{
 const {db,request}=fixture(),auth=await request('/api/staff/login','POST',{password:'local-test-password'}),token=auth.token;
 const order=await request('/api/staff/orders','POST',{table:'T05',items:[item(2)],idempotencyKey:'split_payment_test_abcdef'},token);assert.equal(order.status,201);
 const split=await request('/api/staff/orders/'+order.order.id+'/split','POST',{version:order.order.version,parts:[[{index:0,qty:1}],[{index:0,qty:1}]]},token);
 assert.equal(split.status,200,JSON.stringify(split));assert.equal(split.jobs.length,0);
 const first=split.bills[0],last=split.bills[1];assert.equal(first.bankPayment.content,order.order.code+'B1');
 const one=await request('/api/staff/bills/'+encodeURIComponent(first.id)+'/pay','POST',{method:'BANK'},token);assert.equal(one.status,200,JSON.stringify(one));assert.equal(one.jobs.length,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(order.order.id).n,0);
 const two=await request('/api/staff/bills/'+encodeURIComponent(last.id)+'/pay','POST',{method:'CASH',received:last.total},token);assert.equal(two.status,200,JSON.stringify(two));assert.equal(two.order.paymentStatus,'PAID');assert.equal(two.jobs.length,1);
 assert.equal(two.jobs[0].items[0].qty,2);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(order.order.id).n,1);
 assert.equal((await request('/api/staff/orders?code='+order.order.code+'-B1','GET',undefined,token)).orders[0].id,order.order.id);
});
