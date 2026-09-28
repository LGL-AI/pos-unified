import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {applyCurrentSchema} from './helpers/schema.mjs';
import worker from '../src/worker.js';

function fixture(){
 const db=new DatabaseSync(':memory:');applyCurrentSchema(db);
 const DB={prepare(sql){let a=[];return {bind(...v){a=v;return this},async first(){return db.prepare(sql).get(...a)||null},async all(){return {results:db.prepare(sql).all(...a)}},async run(){return {meta:{changes:db.prepare(sql).run(...a).changes}}},_run(){return db.prepare(sql).run(...a)}}},async batch(queries){db.exec('BEGIN');try{const out=queries.map(x=>x._run());db.exec('COMMIT');return out}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ASSETS:{fetch:async()=>new Response('missing',{status:404})},ORDERING_ENABLED:'true',SESSION_SECRET:'customer-test-secret-0123456789abcdef',POS_STAFF_PASSWORD:'customer-test-password'};
 const ask=async(path,method='GET',data,token)=>{const r=await worker.fetch(new Request('https://pos.test'+path,{method,headers:{Origin:'https://pos.test',...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},body:data===undefined?undefined:JSON.stringify(data)}),env);return {status:r.status,...await r.json()}};
 return {db,ask};
}

test('POC customer form uses member D1 ledger, enforces permissions and accrues payment points',async()=>{
 const {db,ask}=fixture(),auth=await ask('/api/staff/login','POST',{password:'customer-test-password'}),token=auth.token;
 assert.equal(auth.status,200);
 const profile={name:'Nguyễn Lan',phone:'0912345678',email:'lan@example.com',birthday:'1991-06-02',tierOverride:'Gold',note:'Không đá'};
 assert.equal((await ask('/api/staff/customers','POST',profile)).status,401);
 const created=await ask('/api/staff/customers','POST',profile,token);assert.equal(created.status,201,JSON.stringify(created));
 assert.match(created.customer.code,/^KH\d{6}$/);assert.equal(created.customer.tier,'Gold');assert.equal(created.customer.note,'Không đá');
 assert.equal((await ask('/api/staff/customers','POST',profile,token)).status,409);
 const list=await ask('/api/staff/customers?q=lan%40example.com','GET',undefined,token);assert.equal(list.customers.length,1);assert.equal(list.kpis.total,1);assert.equal(list.kpis.gold,1);
 const login=await ask('/api/member/login','POST',{phone:profile.phone,password:profile.phone});assert.equal(login.status,200);assert.equal(login.member.tier,'Gold');
 const updated=await ask('/api/staff/customers/'+created.customer.id,'PATCH',{...profile,name:'Nguyễn Lan Anh',tierOverride:'',version:created.customer.version},token);assert.equal(updated.status,200,JSON.stringify(updated));assert.equal(updated.customer.tier,'Member');
 assert.equal((await ask('/api/staff/customers/'+created.customer.id,'PATCH',{...profile,version:created.customer.version},token)).status,409);
 const order=await ask('/api/staff/orders','POST',{table:'T01',memberId:created.customer.id,items:[{productId:'EC_MAIN001',qty:1,mods:{size:'中',spice:'中'}}],idempotencyKey:'customer_order_abcdef123456'},token);assert.equal(order.status,201,JSON.stringify(order));
 const paid=await ask('/api/staff/orders/'+order.order.id+'/pay','POST',{version:order.order.version,method:'CASH',received:order.order.total},token);assert.equal(paid.status,200,JSON.stringify(paid));
 const after=await ask('/api/staff/customers/'+created.customer.id,'GET',undefined,token);assert.equal(after.customer.orders,1);assert.equal(after.customer.spend,paid.order.total);assert.ok(after.customer.points>0);assert.equal(after.recentOrders[0].code,paid.order.code);
 const labels=await ask('/api/staff/paid-labels','GET',undefined,token);assert.equal(labels.jobs.length,1);assert.equal(labels.jobs[0].order.id,order.order.id);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM members').get().n,1);db.close();
});
