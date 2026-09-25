import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/worker.js';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){for(let n=0;n<60;n++){if(check())return;await sleep(20)}assert.fail('Shared D1 change did not reach another UI')}

test('counter stock reaches an open QR and handheld; QR order, POS changes and refunds reach all four screens',async()=>{
 const db=new DatabaseSync(':memory:');
 for(const n of ['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql','0006_counter_display.sql','0007_counter_management.sql','0008_store_config.sql'])db.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 db.prepare("UPDATE vouchers SET active=1,listed=1 WHERE code='SAVE20'").run();
 const DB={prepare(sql){let a=[];return{bind(...v){a=v;return this},async first(){return db.prepare(sql).get(...a)||null},async all(){return{results:db.prepare(sql).all(...a)}},async run(){return{meta:{changes:db.prepare(sql).run(...a).changes}}},_run(){return db.prepare(sql).run(...a)}}},async batch(queries){db.exec('BEGIN');try{const r=queries.map(x=>x._run());db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ORDERING_ENABLED:'true',SESSION_SECRET:'cross-ui-secret-0123456789abcdef0123456789',POS_STAFF_PASSWORD:'test-counter-password',BANK_BIN:'970448',BANK_ACCOUNT_NUMBER:'609271',BANK_ACCOUNT_NAME:'HUANG TIANSHENG'};
 let cookie='';
 const raw=(path,opts={})=>worker.fetch(new Request('https://pos.test'+path,{method:opts.method||'GET',headers:{Origin:'https://pos.test',...(cookie?{Cookie:cookie}:{}),...opts.headers},body:opts.body}),env);
 const ask=async(path,method='GET',value,headers={})=>{const r=await raw(path,{method,headers:{...headers,...(value===undefined?{}:{'Content-Type':'application/json'})},body:value===undefined?undefined:JSON.stringify(value)});return{status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};
 const member=await ask('/api/member/register','POST',{phone:'0912345678',name:'Khách đồng bộ',password:'cross-ui-password-123'});
 assert.equal(member.status,201);cookie=member.cookie;

 function pos(mode){
  const app={innerHTML:''},connection={textContent:'',classList:{toggle(){}}},productList={innerHTML:''},listeners={},timers=new Map(),store=new Map(),session=new Map();
  let stockQty='10';
  const fields={'#pos-menu-stock':productList,'#order-note':{value:''},'#voucher':{value:''},'#member-phone':{value:'0912345678'},'#split-count':{value:'4'}};
  const document={body:{dataset:{mode}},hidden:false,activeElement:null,querySelector(s){return s==='#app'?app:s==='#connection'?connection:fields[s]||null},addEventListener(k,v){listeners[k]=v}};
  const context={document,location:{origin:'https://pos.test'},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},navigator:{},crypto,Response,Request,URL,Intl,JSON,Number,Array,String,Math,Date,console,AbortSignal,setTimeout:(fn,ms)=>ms===7000?0:setTimeout(fn,ms),clearTimeout,setInterval:(fn,ms)=>timers.set(ms,fn),confirm:()=>true,prompt:(label,value)=>label.includes('Số lượng nhập')?stockQty:label.includes('mật khẩu hội viên')?'cross-ui-password-123':label.includes('Lý do hoặc')?'Phiếu đồng bộ':value??'',fetch:raw};
  context.window=context;vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../public/staff/qrcode.js',import.meta.url),'utf8'),context);
  vm.runInContext(readFileSync(new URL('../public/staff/staff.js',import.meta.url),'utf8'),context);
  return{app,productList,store,session,timers,context,qty:v=>stockQty=v,click:async dataset=>listeners.click({target:{closest:()=>({dataset,disabled:false})}}),login:async()=>listeners.submit({target:{id:'login',password:{value:env.POS_STAFF_PASSWORD}},preventDefault(){}})};
 }
 function qr(){
  const app={innerHTML:''},products={innerHTML:''},banner={innerHTML:''},hero={innerHTML:''},cartStatus={innerHTML:''},listeners={},timers=new Map(),store=new Map();
  const nodes={'#app':app,'#product-list':products,'#menu-hero':hero,'#menu-connect':banner,'#cart-connect':cartStatus,'#item-note':{value:''}};
  const document={documentElement:{lang:'vi'},body:{style:{},appendChild(){}},hidden:false,querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener:(key,fn)=>listeners[key]=fn,createElement:()=>({setAttribute(){},appendChild(){},remove(){},click(){}})};
  const context={document,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},location:{search:'?table=T01',href:'https://pos.test/qr/?table=T01'},history:{replaceState(){}},navigator:{onLine:true},crypto,Response,Request,URL,URLSearchParams,Intl,JSON,Number,Array,String,Math,Date,console,AbortSignal,setTimeout:()=>0,clearTimeout,setInterval:(fn,ms)=>timers.set(ms,fn),fetch:raw};
  context.window=context;context.scrollTo=()=>{};context.addEventListener=()=>{};vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../public/assets/qrcode.js',import.meta.url),'utf8'),context);
  vm.runInContext(readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8'),context);
  return{app,products,banner,hero,store,timers,click:dataset=>listeners.click({target:{closest:()=>({dataset})}})};
 }
 const counter=pos('counter'),handheld=pos('staff'),customer=qr();
 await counter.login();await handheld.login();await handheld.click({screen:'new'});
 await until(()=>customer.app.innerHTML.includes('class="sold-out"'));
 assert.doesNotMatch(customer.app.innerHTML,/data-add="101"/);
 assert.doesNotMatch(handheld.app.innerHTML,/data-add="101"/);
 await counter.click({screen:'inventory'});
 await counter.click({adjustTarget:'PRODUCT',stockId:'101',stockKind:'RECEIPT'});
 customer.timers.get(10000)();await sleep(30);
 assert.doesNotMatch(customer.products.innerHTML,/data-add="101"/, 'Product receipt alone does not create ingredients');
 counter.qty('10000');
 for(const ingredient of ['ING-PORK-HOCK','ING-DUCK','ING-CHICKEN','ING-RICE'])await counter.click({adjustTarget:'INGREDIENT',stockId:ingredient,stockKind:'RECEIPT'});
 assert.equal(db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,10);
 customer.timers.get(10000)();await until(()=>customer.products.innerHTML.includes('data-add="101"'));
 assert.match(customer.products.innerHTML,/data-add="101"/, 'An already-open QR can buy the newly stocked meal');
 await handheld.timers.get(10000)();
 assert.match(handheld.productList.innerHTML,/data-add="101"/, 'The other POS receives the same inventory');

 await customer.click({add:'101'});for(let i=0;i<2;i++)customer.click({action:'mod-plus'});
 customer.click({action:'modal-save'});customer.click({view:'cart'});customer.click({offer:'SAVE20'});
 await until(()=>customer.app.innerHTML.includes('voucher-ok'));
 customer.click({action:'submit'});
 await until(()=>customer.store.has('lotus-qr-order:T01'));
 const saved=JSON.parse(customer.store.get('lotus-qr-order:T01')),orderId=saved.order.id;
 assert.equal(saved.order.total,370000,JSON.stringify(saved.order));
 assert.equal(db.prepare('SELECT stock FROM pos_product_inventory WHERE product_id=?').get('101').stock,7);
 await counter.click({screen:'orders'});await handheld.click({screen:'orders'});
 assert.match(counter.app.innerHTML,new RegExp(saved.order.code));assert.match(handheld.app.innerHTML,new RegExp(saved.order.code));
 await handheld.click({open:orderId});await handheld.click({action:'accept'});
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(orderId).n,1);
 await counter.click({open:orderId});await counter.click({screen:'display'});await counter.click({action:'display-pair'});
 const pair=db.prepare('SELECT id FROM pos_display_sessions').get();assert.ok(pair?.id);
 await until(()=>JSON.parse(db.prepare('SELECT snapshot_json FROM pos_display_sessions WHERE id=?').get(pair.id).snapshot_json).code===saved.order.code);
 const pairToken=JSON.parse(counter.session.get('lotus-counter-pair')).token;
 const screen={innerHTML:''},status={textContent:'',classList:{add(){},remove(){}}},displayTimers=new Map(),displaySession=new Map();
 const displayDoc={querySelector:s=>s==='#screen'?screen:status};
 const dc={document:displayDoc,location:{hash:'#token='+pairToken,search:'?id='+pair.id,pathname:'/display/'},sessionStorage:{getItem:k=>displaySession.get(k)||null,setItem:(k,v)=>displaySession.set(k,v)},history:{replaceState(){}},crypto,Response,Request,URL,URLSearchParams,Intl,JSON,Number,Array,String,Math,Date,console,AbortSignal,fetch:raw,setInterval:(fn,ms)=>displayTimers.set(ms,fn)};
 dc.window=dc;vm.createContext(dc);vm.runInContext(readFileSync(new URL('../public/display/display.js',import.meta.url),'utf8'),dc);
 await until(()=>screen.innerHTML.includes(saved.order.code));
 assert.match(screen.innerHTML,/370.000/);

 await handheld.click({action:'append'});await handheld.click({add:'101'});await handheld.click({action:'submit'});
 const appended=db.prepare('SELECT total,version FROM qr_orders WHERE id=?').get(orderId);
 assert.equal(appended.total,500000);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs WHERE order_id=?').get(orderId).n,2);
 await counter.timers.get(10000)();
 await until(()=>JSON.parse(db.prepare('SELECT snapshot_json FROM pos_display_sessions WHERE id=?').get(pair.id).snapshot_json).total===500000);
 await displayTimers.get(3000)();assert.match(screen.innerHTML,/500.000/);
 customer.timers.get(17000)();await until(()=>JSON.parse(customer.store.get('lotus-qr-order:T01')).order.total===500000);
 assert.match(customer.app.innerHTML,/500.000/);
 const old=await ask('/api/staff/orders/'+orderId+'/append','POST',{version:saved.order.version,items:[{productId:'101',qty:1}]},{Authorization:'Bearer '+handheld.store.get('lotus-cloud:staff-session')});
 assert.equal(old.status,409,'Stale POS must not overwrite the appended order');

 await handheld.click({action:'split'});await handheld.click({action:'split-prepare'});await handheld.click({action:'split-confirm'});
 const bills=db.prepare('SELECT id,total FROM pos_bills WHERE order_id=? ORDER BY sequence').all(orderId);
 assert.equal(bills.length,4);assert.equal(bills.reduce((sum,b)=>sum+b.total,0),500000);
 const auth={Authorization:'Bearer '+handheld.store.get('lotus-cloud:staff-session')};
 for(const b of bills.slice(0,3)){
  const p=await ask('/api/staff/bills/'+encodeURIComponent(b.id)+'/pay','POST',{method:'CASH',received:b.total},auth);
  assert.equal(p.status,200,JSON.stringify(p.data));
 }
 assert.equal(db.prepare('SELECT points FROM members WHERE id=?').get(member.data.member.id).points,0);
 const final=await ask('/api/staff/bills/'+encodeURIComponent(bills[3].id)+'/pay','POST',{method:'BANK'},auth);
 assert.equal(final.status,200,JSON.stringify(final.data));
 assert.equal(db.prepare('SELECT points FROM members WHERE id=?').get(member.data.member.id).points,50);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loyalty_transactions WHERE order_id=?').get(orderId).n,1);
 await counter.timers.get(10000)();
 await until(()=>JSON.parse(db.prepare('SELECT snapshot_json FROM pos_display_sessions WHERE id=?').get(pair.id).snapshot_json).paymentStatus==='PAID');
 await displayTimers.get(3000)();assert.match(screen.innerHTML,/Nhân viên đã xác nhận thanh toán/);
 customer.timers.get(17000)();await until(()=>JSON.parse(customer.store.get('lotus-qr-order:T01')).order.paymentStatus==='PAID');
 customer.click({view:'member'});await until(()=>customer.app.innerHTML.includes('50 điểm'));

 const refunded=await ask('/api/staff/refunds','POST',{orderId,billId:bills[0].id,amount:bills[0].total,reason:'Món trả lại còn nguyên',method:'CASH',idempotencyKey:'cross_ui_refund_aaaaaaaaaaa',restockItems:[{productId:'101',quantity:1}],confirmRestock:true},auth);
 assert.equal(refunded.status,201,JSON.stringify(refunded.data));
 assert.equal(db.prepare('SELECT stock FROM pos_product_inventory WHERE product_id=?').get('101').stock,7);
 await counter.timers.get(10000)();
 await until(()=>JSON.parse(db.prepare('SELECT snapshot_json FROM pos_display_sessions WHERE id=?').get(pair.id).snapshot_json).refundedAmount===bills[0].total);
 await displayTimers.get(3000)();assert.match(screen.innerHTML,/Đã hoàn/);
 customer.click({view:'orders'});await until(()=>customer.app.innerHTML.includes('Đã hoàn'));
 assert.equal((await ask('/api/orders/'+orderId,'GET',undefined,{'x-order-token':saved.token})).data.order.refundedAmount,bills[0].total);
 const points=db.prepare('SELECT points FROM members WHERE id=?').get(member.data.member.id).points;
 assert.equal(points,Math.floor((500000-bills[0].total)/10000));
 await counter.click({screen:'new'});await counter.click({action:'lookup'});
 assert.match(counter.app.innerHTML,/Khách đồng bộ/);
 await counter.click({add:'101'});await counter.click({action:'submit'});
 await counter.click({screen:'new'});
 assert.doesNotMatch(counter.app.innerHTML,/Khách đồng bộ/, 'The next customer must not inherit the previous member');
 db.close();
});
