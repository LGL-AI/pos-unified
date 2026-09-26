import {applyCurrentSchema} from './helpers/schema.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';
import {daily} from '../src/reports.js';

test('daily export allocates split bills and next-day refund to their Vietnam calendar days',async()=>{
 const db=new DatabaseSync(':memory:');applyCurrentSchema(db,{legacyMenu:true});
 const DB={prepare(sql){let values=[];return{bind(...v){values=v;return this},async first(){return db.prepare(sql).get(...values)||null},async all(){return{results:db.prepare(sql).all(...values)}},async run(){return{meta:{changes:db.prepare(sql).run(...values).changes}}},_run(){return db.prepare(sql).run(...values)}}},async batch(items){db.exec('BEGIN');try{const r=items.map(x=>x._run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,SESSION_SECRET:'rollover-test-secret-aabbccddeeff00112233',POS_STAFF_PASSWORD:'rollover-password-123456',ORDERING_ENABLED:'true'};
 const ask=async(path,method='GET',body,token='')=>{const r=await worker.fetch(new Request('https://rollover.test'+path,{method,headers:{Origin:'https://rollover.test',...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env);return {status:r.status,...await r.json()}};
 const owner=(await ask('/api/staff/login','POST',{username:'huang',password:env.POS_STAFF_PASSWORD})).token;
 db.prepare("UPDATE pos_product_inventory SET stock=12 WHERE product_id='101'").run();db.prepare('UPDATE pos_ingredients SET stock=100000').run();
 const o=await ask('/api/staff/orders','POST',{table:'T01',items:[{productId:'101',qty:2}],idempotencyKey:'rollover-sale-aaaaaaaaa'},owner);assert.equal(o.status,201);
 const split=await ask('/api/staff/orders/'+o.order.id+'/split','POST',{version:1,parts:[[{index:0,qty:1}],[{index:0,qty:1}]]},owner);assert.equal(split.status,200);
 for(const bill of split.bills)assert.equal((await ask('/api/staff/bills/'+encodeURIComponent(bill.id)+'/pay','POST',{method:'BANK'},owner)).status,200);
 db.prepare("UPDATE pos_bills SET paid_at=? WHERE order_id=? AND sequence=1").run('2026-09-23T16:59:59.000Z',o.order.id);
 db.prepare("UPDATE pos_bills SET paid_at=? WHERE order_id=? AND sequence=2").run('2026-09-23T17:00:01.000Z',o.order.id);
 db.prepare('INSERT INTO pos_refunds(id,idem_key,fingerprint,order_id,bill_id,amount,reason,method,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('r01','refund-rollover-000001','fingerprint',o.order.id,split.bills[0].id,1000,'Rollover','BANK','test','2026-09-24T17:00:01.000Z');
 const first=await daily(env,'2026-09-23'),second=await daily(env,'2026-09-24'),third=await daily(env,'2026-09-25');
 assert.equal(first.paidBills,1);assert.equal(first.gross,split.bills[0].total);assert.equal(first.refunded,0);
 assert.equal(second.paidBills,1);assert.equal(second.gross,split.bills[1].total);assert.equal(second.refunded,0);
 assert.equal(third.paidBills,0);assert.equal(third.gross,0);assert.equal(third.net,-1000);assert.equal(third.refunds.length,1);
 db.close();
});
