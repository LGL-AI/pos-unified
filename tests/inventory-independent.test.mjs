import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/worker.js';
import {upgrade} from '../scripts/upgrade-d1-0009.mjs';
import {applyAfter} from './helpers/schema.mjs';

const migrations=['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql','0006_counter_display.sql','0007_counter_management.sql','0008_store_config.sql'];
function setup(){
 const db=new DatabaseSync(':memory:');
 for(const f of migrations)db.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE)');
 for(const f of migrations)db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(f);
 const query=async(sql,args=[])=>/^(SELECT|PRAGMA)\s/i.test(sql.trim())?db.prepare(sql).all(...args):(db.prepare(sql).run(...args),[]);
 const DB={prepare(sql){let args=[];return {bind(...x){args=x;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:db.prepare(sql).run(...args).changes}}},_run(){return db.prepare(sql).run(...args)}}},async batch(queries){db.exec('BEGIN');try{const result=queries.map(x=>x._run());db.exec('COMMIT');return result}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ASSETS:{fetch:async()=>new Response('',{status:404})},ORDERING_ENABLED:'true',SESSION_SECRET:'abcdefabcdefabcdefabcdefabcdefabcdef',POS_STAFF_PASSWORD:'654321'};
 const call=async(path,method='GET',body,token)=>{const headers={Origin:'https://pos.example'};if(body!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;const response=await worker.fetch(new Request('https://pos.example'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);return {status:response.status,...await response.json()}};
 const login=async()=>{const value=await call('/api/staff/login','POST',{username:'huang',password:'654321'});assert.equal(value.status,200);return value.token};
 const complete=()=>{applyAfter(db,'0009_sales_independent_inventory.sql');db.exec("UPDATE pos_products SET active=1 WHERE id BETWEEN '101' AND '113'");for(const name of ['0010_shift_ops.sql','0011_echo_menu.sql','0012_payment_first_service_receipts.sql','0013_cash_intent_feedback.sql'])db.prepare('INSERT OR IGNORE INTO d1_migrations(name) VALUES(?)').run(name)};
 return {db,query,call,login,upgrade:()=>upgrade({query,log:()=>{}}),complete};
}

test('migration preserves imported stock, does not gate QR or handheld orders and tracks signed estimated usage',async()=>{
 const x=setup();
 x.db.exec("UPDATE pos_product_inventory SET stock=10 WHERE product_id='101'; UPDATE pos_product_inventory SET stock=100 WHERE product_id='107'; UPDATE pos_ingredients SET stock=100 WHERE id='ING-PORK-HOCK'; UPDATE pos_ingredients SET stock=200 WHERE id='ING-RICE';");
 await x.upgrade();x.complete();
 const first=await x.call('/api/catalog');assert.equal(first.catalog.products.find(p=>p.id==='101').available,true);assert.equal(first.catalog.products.find(p=>p.id==='107').available,true);assert.equal(first.catalog.products.find(p=>p.id==='102').available,true);
 const order=await x.call('/api/orders','POST',{table:'T01',items:[{productId:'107',qty:2,mods:{size:'中',spice:'中'}}],idempotencyKey:'estimated-sale-aaaaaaaaaaaa'});
 assert.equal(order.status,201,JSON.stringify(order));
 assert.equal(x.db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='107'").get().stock,100);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='107'").get().estimated_stock,98);
 assert.equal(x.db.prepare("SELECT stock FROM pos_ingredients WHERE id='ING-RICE'").get().stock,200);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='INGREDIENT' AND ref_id='ING-RICE'").get().estimated_stock,-300);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='INGREDIENT' AND ref_id='ING-PORK-HOCK'").get().estimated_stock,-300);
 const token=await x.login();
 const staff=await x.call('/api/staff/orders','POST',{table:'T02',items:[{productId:'102',qty:3,mods:{size:'中',spice:'中'}}],idempotencyKey:'staff-unstocked-aaaaaaaaaaa'},token);
 assert.equal(staff.status,201,JSON.stringify(staff));
 assert.equal(x.db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='102'").get().stock,0);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='102'").get().estimated_stock,-3);
 const duplicate=await x.call('/api/orders','POST',{table:'T01',items:[{productId:'107',qty:2,mods:{size:'中',spice:'中'}}],idempotencyKey:'estimated-sale-aaaaaaaaaaaa'});
 assert.equal(duplicate.duplicate,true);assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='107'").get().estimated_stock,98);
 const inv=await x.call('/api/staff/inventory','GET',undefined,token);assert.equal(inv.status,200);assert.equal(inv.ingredients.find(i=>i.id==='ING-RICE').stock,200);
 assert.equal(inv.estimates.find(i=>i.target==='INGREDIENT'&&i.ref_id==='ING-RICE').estimated_stock,-1050);
 x.db.close();
});

test('stock receipts, partial cancellation and order cancellation adjust only estimates while keeping physical counts independent',async()=>{
 const x=setup();await x.upgrade();x.complete();const token=await x.login();
 const item=(qty=1)=>({productId:'107',qty,mods:{size:'中',spice:'中'}});
 const order=await x.call('/api/staff/orders','POST',{table:'T01',items:[item(2)],idempotencyKey:'independent-cancel-aaaaaaa'},token);
 assert.equal(order.status,201,JSON.stringify(order));
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='107'").get().estimated_stock,-2);
 const accepted=await x.call('/api/staff/orders/'+order.order.id+'/accept','POST',{version:1},token);assert.equal(accepted.status,200);
 const appended=await x.call('/api/staff/orders/'+order.order.id+'/append','POST',{version:accepted.order.version,items:[item(2)]},token);
 assert.equal(appended.status,200,JSON.stringify(appended));
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='107'").get().estimated_stock,-4);
 const receipt=await x.call('/api/staff/inventory/adjust','POST',{target:'INGREDIENT',id:'ING-RICE',quantity:300,kind:'RECEIPT',reference:'Nhập nguyên liệu có thật',idempotencyKey:crypto.randomUUID()},token);
 assert.equal(receipt.status,200);
 assert.equal(x.db.prepare("SELECT stock FROM pos_ingredients WHERE id='ING-RICE'").get().stock,300);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='INGREDIENT' AND ref_id='ING-RICE'").get().estimated_stock,-700);
 const unit=await x.call('/api/staff/orders/'+order.order.id+'/cancel-unit','POST',{version:appended.order.version,index:0,reason:'Khách đổi ý'},token);
 assert.equal(unit.status,200,JSON.stringify(unit));
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='107'").get().estimated_stock,-3);
 const cancel=await x.call('/api/staff/orders/'+order.order.id+'/cancel','POST',{version:unit.order.version,reason:'Hủy đơn còn lại'},token);
 assert.equal(cancel.status,200,JSON.stringify(cancel));
 assert.equal(x.db.prepare("SELECT stock FROM pos_ingredients WHERE id='ING-RICE'").get().stock,300);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='INGREDIENT' AND ref_id='ING-RICE'").get().estimated_stock,300);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='107'").get().estimated_stock,0);
 x.db.close();
});

test('partly installed migration blocks new traffic, then resumes without duplicating physical receipts',async()=>{
 const x=setup();x.db.exec("UPDATE pos_product_inventory SET stock=2 WHERE product_id='107'; UPDATE pos_ingredients SET stock=2000;");
 await assert.rejects(upgrade({query:async(sql,args)=>{if(sql.includes('CREATE TRIGGER IF NOT EXISTS pos_stock_change_v9'))throw Error('interrupted');return x.query(sql,args)},log:()=>{}}),/interrupted/);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='trigger' AND name='pos_stock_new'").get().n,1);
 const blocked=await x.call('/api/orders','POST',{table:'T01',items:[{productId:'107',qty:1,mods:{size:'中',spice:'中'}}],idempotencyKey:'sale-during-upgrade-aaaaaa'});
 assert.equal(blocked.status,503);assert.equal(blocked.code,'ORDERING_NOT_CONFIGURED');
 assert.equal(x.db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='107'").get().stock,2);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='107'").get().estimated_stock,2);
 await x.upgrade();await x.upgrade();
 assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,9);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE type='trigger' AND name='pos_stock_new'").get().n,0);
 x.complete();const newOrder=await x.call('/api/orders','POST',{table:'T01',items:[{productId:'107',qty:4,mods:{size:'中',spice:'中'}}],idempotencyKey:'sale-after-upgrade-aaaaaaa'});
 assert.equal(newOrder.status,201,JSON.stringify(newOrder));
 assert.equal(x.db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='107'").get().stock,2);
 assert.equal(x.db.prepare("SELECT estimated_stock FROM pos_inventory_estimates WHERE target='PRODUCT' AND ref_id='107'").get().estimated_stock,-2);
 x.db.close();
});

test('real QR screen offers a zero-stock active dish and D1 accepts its order without a receipt',async()=>{
 const x=setup();await x.upgrade();x.complete();
 const catalog=await x.call('/api/catalog');assert.equal(catalog.catalog.products.find(p=>p.id==='101').stock,0);
 const app={innerHTML:''},listeners={},storage=new Map();
 const document={documentElement:{lang:'vi'},body:{style:{},appendChild(){}},querySelector:s=>s==='#app'?app:null,addEventListener:(name,fn)=>{listeners[name]=fn}};
 const context={document,window:null,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},location:{search:'?table=T01',href:'https://pos.example/qr/?table=T01',protocol:'https:',hostname:'pos.example'},history:{replaceState(){}},navigator:{onLine:true},crypto,Response,Request,URL,URLSearchParams,Intl,JSON,Number,Array,String,Math,Date,console,AbortSignal,setTimeout:()=>0,clearTimeout,setInterval:()=>0,fetch:async(path,opts={})=>{const result=await x.call(path,opts.method||'GET',opts.body?JSON.parse(opts.body):undefined);return new Response(JSON.stringify(result),{status:result.status})}};
 context.window=context;context.scrollTo=()=>{};context.addEventListener=()=>{};
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8'),context);
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.match(app.innerHTML,/data-add="101"/);
 assert.match(app.innerHTML,/Set cơm chân giò sang trọng tối thượng/);
 const order=await x.call('/api/orders','POST',{table:'T01',items:[{productId:'101',qty:1,mods:{size:'中',spice:'中'}}],idempotencyKey:'qr-zero-stock-aaaaaaaaaa'});
 assert.equal(order.status,201,JSON.stringify(order));
 assert.equal(x.db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,0);
 x.db.close();
});
