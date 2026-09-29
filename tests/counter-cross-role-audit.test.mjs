import test from 'node:test';
import assert from 'node:assert/strict';
import {auditFixture} from './helpers/audit-fixture.mjs';

test('cross-role audit: QR → cashier → manager split → payment → one kitchen job',async t=>{
 const {db,call,login}=auditFixture();t.after(()=>db.close());const owner=await login();
 const accounts={};
 for(const role of ['CASHIER','MANAGER']){
  const username='audit_'+role.toLowerCase(),password='audit-staff-password';
  const made=await call('/api/staff/accounts','POST',{username,password,name:role,role},owner);
  assert.equal(made.status,201,JSON.stringify(made));accounts[role]={id:made.account.id,token:await login(username,password)};
 }
 const cashier=accounts.CASHIER.token,manager=accounts.MANAGER.token;
 await t.test('cashier cannot create owner accounts or edit products',async()=>{
  assert.equal((await call('/api/staff/accounts','POST',{username:'bad',name:'bad',password:'password',role:'MANAGER'},cashier)).status,403);
  assert.equal((await call('/api/staff/products','POST',{},cashier)).status,403);
 });
 await t.test('cashier cannot create vouchers or assign schedules',async()=>{
  assert.equal((await call('/api/staff/vouchers','POST',{},cashier)).status,403);
  assert.equal((await call('/api/staff/schedules','POST',{},cashier)).status,403);
 });
 let order,bills;
 await t.test('QR order at T07 accepts zero physical stock without printing',async()=>{
  const r=await call('/api/orders?table=T07','POST',{table:'T07',items:[{productId:'101',qty:3}],idempotencyKey:crypto.randomUUID()});
  assert.equal(r.status,201,JSON.stringify(r));order=r.order;
  assert.equal(order.table,'T07');assert.equal(db.prepare('SELECT COUNT(*) n FROM pos_kitchen_jobs').get().n,0);
  assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,0);
 });
 await t.test('cashier sees QR order and manager splits into three exact bills',async()=>{
  assert.equal((await call('/api/staff/orders/'+order.id,'GET',null,cashier)).order.id,order.id);
  const accepted=await call('/api/staff/orders/'+order.id+'/accept','POST',{version:order.version},cashier);
  assert.equal(accepted.status,200,JSON.stringify(accepted));order=accepted.order;
  const r=await call('/api/staff/orders/'+order.id+'/split','POST',{version:order.version,parts:[[{index:0,qty:1}],[{index:0,qty:1}],[{index:0,qty:1}]]},manager);
  assert.equal(r.status,200,JSON.stringify(r));bills=r.bills;
  assert.equal(bills.reduce((s,b)=>s+b.total,0),order.total);assert.equal(r.jobs.length,0);
 });
 await t.test('pay first two bills across roles: no kitchen order yet',async()=>{
  for(const [i,token] of [[0,cashier],[1,manager]]){
   const r=await call('/api/staff/bills/'+bills[i].id+'/pay','POST',{method:'CASH',received:bills[i].total},token);
   assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.jobs.length,0);
  }
 });
 await t.test('last bill BANK creates kitchen once; repeat payment never creates another',async()=>{
  const path='/api/staff/bills/'+bills[2].id+'/pay';
  const r=await call(path,'POST',{method:'BANK'},owner);assert.equal(r.status,200,JSON.stringify(r));
  assert.equal(r.order.paymentStatus,'PAID');
  await call(path,'POST',{method:'BANK'},cashier);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pos_kitchen_jobs WHERE order_id=?').get(order.id).n,1);
 });
 await t.test('two terminals cannot both claim the same kitchen job',async()=>{
  const job=db.prepare('SELECT id FROM pos_kitchen_jobs WHERE order_id=?').get(order.id);
  const results=await Promise.all([cashier,manager].map(token=>call('/api/staff/jobs/'+encodeURIComponent(job.id)+'/claim','POST',{},token)));
  assert.equal(results.filter(r=>r.status==='CLAIMED').length,1);
  assert.equal(results.filter(r=>r.status===409).length,1);
 });
 await t.test('no append after payment, no inventory receipt required for next QR customer',async()=>{
  assert.notEqual((await call('/api/staff/orders/'+order.id+'/append','POST',{version:1,items:[{productId:'101',qty:1}]},cashier)).status,200);
  const r=await call('/api/orders?table=T08','POST',{table:'T08',items:[{productId:'101',qty:1}],idempotencyKey:crypto.randomUUID()});
  assert.equal(r.status,201,JSON.stringify(r));
 });
});

test('overtime approval rejects overlap with a scheduled shift',async t=>{
 const {db,call,login}=auditFixture();t.after(()=>db.close());const owner=await login();
 const made=await call('/api/staff/accounts','POST',{username:'audit_ot',password:'audit-ot-password',name:'OT',role:'CASHIER'},owner);
 const staff=made.account.id,token=await login('audit_ot','audit-ot-password');
 const workDate='2026-10-05';
 assert.equal((await call('/api/staff/schedules','POST',{staffId:staff,workDate,startTime:'08:00',endTime:'12:00'},owner)).status,201);
 const ot=await call('/api/staff/shift-ops/ot','POST',{requestKey:crypto.randomUUID(),workDate,startTime:'11:00',endTime:'13:00',reason:'test overlap'},token);
 assert.equal(ot.status,201);
 const approved=await call('/api/staff/shift-ops/ot/'+ot.id+'/status','POST',{status:'APPROVED',version:1},owner);
 assert.equal(approved.status,409,JSON.stringify(approved));
 const makeOT=async(startTime,endTime)=>call('/api/staff/shift-ops/ot','POST',{requestKey:crypto.randomUUID(),workDate,startTime,endTime,reason:'audit overtime'},token);
 const valid=await makeOT('18:00','20:00');assert.equal(valid.status,201);
 assert.equal((await call('/api/staff/shift-ops/ot/'+valid.id+'/status','POST',{status:'APPROVED',version:1},token)).status,403,'Staff cannot approve own overtime');
 assert.equal((await call('/api/staff/shift-ops/ot/'+valid.id+'/status','POST',{status:'APPROVED',version:1},owner)).status,200);
 const duplicate=await makeOT('19:00','21:00');
 assert.equal((await call('/api/staff/shift-ops/ot/'+duplicate.id+'/status','POST',{status:'APPROVED',version:1},owner)).status,409);
 assert.equal((await call('/api/staff/schedules','POST',{staffId:staff,workDate,startTime:'19:00',endTime:'21:00'},owner)).status,409,'Cannot assign regular shift over approved overtime');
 assert.equal((await call('/api/staff/schedules','POST',{staffId:staff,workDate,startTime:'20:00',endTime:'21:00'},owner)).status,201,'Adjacent shift is valid');
});
