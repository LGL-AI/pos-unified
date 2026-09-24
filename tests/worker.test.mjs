import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker.js';

const db=new DatabaseSync(':memory:');
for(const n of ['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql'])db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));db.exec('UPDATE pos_product_inventory SET stock=100; UPDATE pos_ingredients SET stock=100000;');
const DB={prepare(sql){let args=[];return {bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return {results:db.prepare(sql).all(...args)}},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:r.changes}}},_run(){return db.prepare(sql).run(...args)}}},async batch(statements){db.exec('BEGIN');try{const results=statements.map(q=>q._run());db.exec('COMMIT');return results}catch(e){db.exec('ROLLBACK');throw e}}};
const env={DB,ASSETS:{fetch:async()=>new Response('not found',{status:404})},ORDERING_ENABLED:'true',ALLOW_UNVERIFIED_MEMBER_VOUCHERS:'true',SESSION_SECRET:'local-test-secret-aabbccddeeff00112233445566778899',POS_STAFF_PASSWORD:'local-staff-password-only-for-tests',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'1234567890',BANK_ACCOUNT_NAME:'PHAT TAI TEST'};
const send=async(path,method='GET',body=null,extra={},settings=env)=>{const headers={'Origin':'https://qr.example.test',...extra};if(body!==null)headers['Content-Type']='application/json';const resp=await worker.fetch(new Request('https://qr.example.test'+path,{method,headers,body:body===null?undefined:JSON.stringify(body)}),settings);const ct=resp.headers.get('Content-Type')||'';return {status:resp.status,headers:resp.headers,data:ct.includes('json')?await resp.json():await resp.text()}};
const item=(qty=2)=>({productId:'101',qty,price:1,mods:{size:'中',spice:'不辣',note:'không hành'}});
const order=(key)=>({table:'T01',idempotencyKey:key,items:[item()],note:'gần cửa',total:1});
const register=(phone='0912345678')=>({name:'Lê Thanh Bình',phone,password:'long-and-safe-test-password-2026'});
const cookieOf=r=>r.headers.get('set-cookie')?.split(';')[0];

await test('secure default, health and no kitchen routes or assets',async()=>{
 assert.equal((await send('/api/health','GET',null,{}, {...env,ORDERING_ENABLED:'false'})).data.acceptingOrders,false);
 assert.equal((await send('/api/health','GET',null,{}, {...env,DB:undefined})).data.acceptingOrders,false);
 assert.equal((await send('/api/health')).data.acceptingOrders,true);
 assert.equal((await send('/api/health')).data.d1,'ok');
 assert.equal((await send('/api/catalog')).data.catalog.products.length,13);
 for(const path of ['/kitchen/','/assets/kitchen.js'])assert.equal((await send(path)).status,404,path);
 assert.equal((await send('/api/staff/orders')).status,401);
 assert.equal((await send('/api/orders','GET')).status,405);
 assert.equal((await send('/api/orders','POST',order('test_req_0123456789012345'),{'Origin':'https://evil.example'})).status,403);
});
await test('register, login, logout, wrong password and private member cookie',async()=>{
 const r=await send('/api/member/register','POST',register());assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.member.pointsSynced,true);assert.equal(r.data.member.tier,'Member');assert.equal(r.data.member.spend,0);assert.equal(r.data.member.phoneVerified,false);
 assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);
 assert.ok(!JSON.stringify(r.data).includes('password_hash'));
 const stored=db.prepare('SELECT password_hash,password_salt FROM members WHERE phone=?').get('0912345678');assert.notEqual(stored.password_hash,register().password);assert.ok(stored.password_salt.length>=16);
 globalThis.memberCookie=cookieOf(r);
 assert.equal((await send('/api/member/me','GET',null,{'Cookie':globalThis.memberCookie})).data.member.displayName,'Lê Thanh Bình');
 assert.equal((await send('/api/member/register','POST',register())).status,409);
 assert.equal((await send('/api/member/login','POST',{phone:'0912345678',password:'wrong-password'})).status,401);
 const login=await send('/api/member/login','POST',{phone:'+84912345678',password:register().password});assert.equal(login.status,200);globalThis.memberCookie=cookieOf(login);
 assert.equal((await send('/api/member/logout','POST',{}, {'Cookie':globalThis.memberCookie})).status,200);
 assert.equal((await send('/api/member/me','GET',null,{'Cookie':globalThis.memberCookie})).data.member,null);
 const again=await send('/api/member/login','POST',{phone:'0912345678',password:register().password});globalThis.memberCookie=cookieOf(again);
});
await test('vouchers start disabled, member-only eligibility and authoritative discount',async()=>{
 const hidden=await send('/api/vouchers');assert.equal(hidden.data.vouchers.length,0);
 assert.equal((await send('/api/vouchers/validate','POST',{...order('voucher_validation_abc0000000'),voucherCode:'WELCOME10'})).status,400);
 db.prepare("UPDATE vouchers SET active=1,listed=1,max_uses=2 WHERE code='WELCOME10'").run();
 db.prepare("UPDATE vouchers SET active=1,listed=1,max_uses=1 WHERE code='SAVE20'").run();
 const list=(await send('/api/vouchers')).data.vouchers;assert.equal(list.length,2);
 const input={...order('voucher_validation_abc0000000'),voucherCode:'WELCOME10'};
 assert.equal((await send('/api/vouchers/validate','POST',input)).status,401);
 const guarded=await send('/api/vouchers/validate','POST',input,{'Cookie':globalThis.memberCookie},{...env,ALLOW_UNVERIFIED_MEMBER_VOUCHERS:'false'});assert.equal(guarded.status,403);assert.equal(guarded.data.code,'PHONE_NOT_VERIFIED');
 const v=await send('/api/vouchers/validate','POST',input,{'Cookie':globalThis.memberCookie});assert.equal(v.status,200,JSON.stringify(v.data));assert.equal(v.data.subtotal,260000);assert.equal(v.data.discount,26000);assert.equal(v.data.total,234000);
 const min=await send('/api/vouchers/validate','POST',{...order('voucher_validation_abc0000001'),items:[{...item(1),productId:'108'}],voucherCode:'SAVE20'});assert.equal(min.status,400);assert.equal(min.data.code,'VOUCHER_MIN');
});
await test('member order one-time voucher reservation, idempotency and private order token',async()=>{
 const payload={...order('qr_member_order_aaaaaaaaaaaaaaaa'),voucherCode:'WELCOME10'};
 const first=await send('/api/orders','POST',payload,{'Cookie':globalThis.memberCookie});assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(first.data.order.total,234000);assert.equal(first.data.order.discount,26000);assert.equal(first.data.order.memberName,'Lê Thanh Bình');assert.ok(first.data.orderToken);
 globalThis.memberOrder=first.data;
 const reserved=db.prepare("SELECT reserved_count,redeemed_count FROM vouchers WHERE code='WELCOME10'").get();assert.equal(reserved.reserved_count,1);assert.equal(reserved.redeemed_count,0);
 const again=await send('/api/orders','POST',payload,{'Cookie':globalThis.memberCookie});assert.equal(again.status,200);assert.equal(again.data.duplicate,true);assert.equal(again.data.order.id,first.data.order.id);
 assert.equal(db.prepare("SELECT reserved_count FROM vouchers WHERE code='WELCOME10'").get().reserved_count,1);
 assert.equal((await send('/api/orders','POST',{...payload,note:'khác'}, {'Cookie':globalThis.memberCookie})).status,409);
 assert.equal((await send('/api/orders/'+first.data.order.id,'GET',null,{'x-order-token':'fake'})).status,403);
 const mine=await send('/api/orders/'+first.data.order.id,'GET',null,{'x-order-token':first.data.orderToken});assert.equal(mine.data.order.voucherCode,'WELCOME10');
 assert.equal('member_id' in mine.data.order,false);
 const second=await send('/api/orders','POST',{...payload,idempotencyKey:'qr_member_order_bbbbbbbbbbbbbbbb'}, {'Cookie':globalThis.memberCookie});assert.equal(second.status,409);assert.equal(second.data.code,'VOUCHER_MEMBER_LIMIT');
});
await test('guest voucher quota guard atomic & independent guest order',async()=>{
 const guest={...order('qr_guest_order_aaaaaaaaaaaaaaaa'),voucherCode:'SAVE20'};
 const first=await send('/api/orders','POST',guest);assert.equal(first.status,201);assert.equal(first.data.order.total,240000);assert.equal(first.data.order.memberName,null);
 const retry=await send('/api/orders','POST',guest);assert.equal(retry.status,200);assert.equal(db.prepare("SELECT reserved_count FROM vouchers WHERE code='SAVE20'").get().reserved_count,1);
 const sold=await send('/api/orders','POST',{...guest,idempotencyKey:'qr_guest_order_bbbbbbbbbbbbbbbb'});assert.equal(sold.status,400);assert.equal(sold.data.code,'VOUCHER_FULL');
 const plain=await send('/api/orders','POST',order('qr_guest_plain_order_aaaaaaaaaaaa'));assert.equal(plain.status,201);assert.equal(plain.data.order.total,260000);assert.equal(plain.data.order.paymentStatus,'UNPAID');
});
await test('legacy v1.1 order survives additive migration and old kitchen auth is removed',async()=>{
 const old=new DatabaseSync(':memory:');old.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
 old.prepare(`INSERT INTO qr_orders(id,idem_key,fingerprint,token_hash,code,table_id,items_json,total,note,status,payment_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('legacy-uuid','legacy-idem','legacy-fingerprint','legacy-token','PT-LEGACY','T01','[]',99000,'','NEW','UNPAID','2026-09-22T00:00:00.000Z','2026-09-22T00:00:00.000Z');
 old.exec(readFileSync(new URL('../migrations/0002_customer_members_vouchers.sql',import.meta.url),'utf8'));
 const row=old.prepare('SELECT code,total,subtotal,discount FROM qr_orders WHERE id=?').get('legacy-uuid');assert.equal(row.code,'PT-LEGACY');assert.equal(row.total,99000);assert.equal(row.subtotal,null);assert.equal(row.discount,0);
 assert.equal(old.prepare("SELECT COUNT(*) AS n FROM vouchers WHERE active=1").get().n,0);
 assert.equal(old.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='kitchen_sessions'").get().n,0);old.close();
});
await test('auth rate limit blocks repeated failures per IP',async()=>{
 const headers={'CF-Connecting-IP':'203.0.113.252'};for(let n=0;n<8;n++)assert.equal((await send('/api/member/login','POST',{phone:'0999999999',password:'anything'},headers)).status,401);
 const ninth=await send('/api/member/login','POST',{phone:'0999999999',password:'anything'},headers);assert.equal(ninth.status,429);
});
await test('production disabled never creates order but keeps member profile accessible',async()=>{
 const paused={...env,ORDERING_ENABLED:'false'};
 const r=await send('/api/orders','POST',order('qr_paused_order_aaaaaaaaaaaa'),{},paused);assert.equal(r.status,503);
 assert.equal((await send('/api/member/me','GET',null,{'Cookie':globalThis.memberCookie},paused)).status,200);
 assert.equal((await send('/api/orders/'+globalThis.memberOrder.order.id,'GET',null,{'x-order-token':globalThis.memberOrder.orderToken},paused)).status,200);
});
