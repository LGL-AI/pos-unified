import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import worker from '../src/worker.js';
import {applyCurrentSchema} from './helpers/schema.mjs';

// Every numbered case owns a fresh D1-shaped SQLite database. These are local
// customer journeys, never evidence that the real Cloudflare D1 or printers passed UAT.
function fixture(){
 const db=new DatabaseSync(':memory:');applyCurrentSchema(db);
 const DB={prepare(sql){let args=[];return{bind(...v){args=v;return this},async first(){return db.prepare(sql).get(...args)||null},async all(){return{results:db.prepare(sql).all(...args)}},async run(){return{meta:{changes:db.prepare(sql).run(...args).changes}}},_run(){return db.prepare(sql).run(...args)}}},async batch(statements){db.exec('BEGIN');try{const rows=statements.map(s=>s._run());db.exec('COMMIT');return rows}catch(e){db.exec('ROLLBACK');throw e}}};
 const env={DB,ASSETS:{fetch:async()=>new Response('not found',{status:404})},ORDERING_ENABLED:'true',SESSION_SECRET:'customer-journey-secret-0123456789-0123456789',POS_STAFF_PASSWORD:'local-test-owner-password'};
 let sequence=0;
 const raw=(path,options={})=>worker.fetch(new Request('https://pos.test'+path,{method:options.method||'GET',headers:{Origin:'https://pos.test',...options.headers},body:options.body}),env);
 const call=async(path,method='GET',data,headers={})=>{const r=await raw(path,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),'CF-Connecting-IP':'198.51.100.'+(++sequence%200+1),...headers},body:data===undefined?undefined:JSON.stringify(data)});return{status:r.status,headers:r.headers,...await r.json()}};
 const item=(productId='EC_MAIN001',qty=1,mods)=>({productId,qty,...(mods?{mods}:{})});
 const order=(changes={},headers={})=>call('/api/orders','POST',{table:'T01',items:[item()],idempotencyKey:'customer_journey_'+String(++sequence).padStart(6,'0'),...changes},headers);
 return{db,env,raw,call,item,order};
}
const cases=[];
function group(name,entries){cases.push({name,entries})}
const expect=async(promise,status,code)=>{const r=await promise;assert.equal(r.status,status,JSON.stringify(r));if(code)assert.equal(r.code,code);return r};
const value=f=>f.db.prepare('SELECT COUNT(*) AS n FROM qr_orders').get().n;
const jobs=f=>f.db.prepare('SELECT COUNT(*) AS n FROM pos_kitchen_jobs').get().n;
const services=f=>f.db.prepare('SELECT COUNT(*) AS n FROM pos_service_requests').get().n;
const voucher=(f,code,kind='FIXED',amount=10000)=>f.db.prepare(`INSERT INTO vouchers(id,code,title_vi,title_zh,kind,value,min_spend,max_discount,member_only,active,listed,starts_at,ends_at,max_uses,per_member_limit) VALUES(?,?,?,?,?,?,0,0,0,1,1,'2026-01-01T00:00:00Z','2028-12-31T00:00:00Z',0,0)`).run(code,code,'Ưu đãi '+code,'优惠 '+code,kind,amount);

group('A · Quét bàn và xem thực đơn',[
 ['01 Danh mục công khai có đúng 85 SKU Echo đang bán',async f=>{const r=await expect(f.call('/api/catalog'),200);assert.equal(r.catalog.products.filter(p=>p.active).length,85)}],
 ['02 Tên và logo Echo hiện trong dữ liệu công khai',async f=>{const r=await f.call('/api/catalog');assert.equal(r.catalog.store.name,'Echo Coffee');assert.equal(r.catalog.store.logo,true)}],
 ['03 Danh mục không lộ tài khoản ngân hàng trước khi đặt',async f=>{const r=await f.call('/api/catalog');assert.equal('bankAccount' in r.catalog.store,false);assert.equal('bankBin' in r.catalog.store,false)}],
 ['04 Mã bàn T01 tạo đơn đúng bàn',async f=>{const r=await expect(f.order(),201);assert.equal(r.order.table,'T01')}],
 ['05 Mã bàn T99 ở giới hạn cấu hình vẫn dùng được',async f=>{const r=await expect(f.order({table:'T99'}),201);assert.equal(r.order.table,'T99')}],
 ['06 T100 bị từ chối và không tạo đơn',async f=>{await expect(f.order({table:'T100'}),400,'INVALID_TABLE');assert.equal(value(f),0)}],
 ['07 T00 bị từ chối và không tạo đơn',async f=>{await expect(f.order({table:'T00'}),400,'INVALID_TABLE');assert.equal(value(f),0)}],
 ['08 Khách mang đi dùng bàn TAKEAWAY',async f=>{const r=await expect(f.order({table:'TAKEAWAY'}),201);assert.equal(r.order.table,'TAKEAWAY')}],
 ['09 QR bàn đã gỡ khỏi cấu hình không được đặt món',async f=>{f.db.exec('UPDATE pos_store_config SET table_count=3 WHERE id=1');await expect(f.order({table:'T04'}),400,'INVALID_TABLE');assert.equal(value(f),0)}],
 ['10 Không chọn bàn thì không tạo đơn',async f=>{await expect(f.order({table:''}),400,'INVALID_TABLE');assert.equal(value(f),0)}]
]);
group('B · Giỏ hàng và số lượng',[
 ['11 Giỏ rỗng bị từ chối',async f=>{await expect(f.order({items:[]}),400,'INVALID_CART');assert.equal(value(f),0)}],
 ['12 Món không tồn tại bị từ chối',async f=>{await expect(f.order({items:[f.item('UNKNOWN')]}),400,'UNAVAILABLE_PRODUCT');assert.equal(value(f),0)}],
 ['13 Món demo đã ngừng bán không lọt qua HTTP',async f=>{await expect(f.order({items:[f.item('101')]}),400,'UNAVAILABLE_PRODUCT');assert.equal(value(f),0)}],
 ['14 Số lượng bằng 0 không tạo đơn',async f=>{await expect(f.order({items:[f.item('EC_MAIN001',0)]}),400,'INVALID_QUANTITY');assert.equal(value(f),0)}],
 ['15 Số lượng âm không tạo đơn',async f=>{await expect(f.order({items:[f.item('EC_MAIN001',-1)]}),400,'INVALID_QUANTITY');assert.equal(value(f),0)}],
 ['16 Số lượng thập phân không được làm tròn âm thầm',async f=>{await expect(f.order({items:[f.item('EC_MAIN001',1.5)]}),400,'INVALID_QUANTITY');assert.equal(value(f),0)}],
 ['17 Một dòng món quá 30 phần bị từ chối',async f=>{await expect(f.order({items:[f.item('EC_MAIN001',31)]}),400,'INVALID_QUANTITY');assert.equal(value(f),0)}],
 ['18 Hơn 30 dòng món bị từ chối',async f=>{await expect(f.order({items:Array.from({length:31},()=>f.item())}),400,'INVALID_CART');assert.equal(value(f),0)}],
 ['19 Tổng số phần vượt 60 bị từ chối',async f=>{await expect(f.order({items:[f.item('EC_MAIN001',30),f.item('EC_MAIN003',30),f.item('EC_MAIN004',1)]}),400,'TOO_MANY_ITEMS');assert.equal(value(f),0)}],
 ['20 Giá tự sửa trên điện thoại không thay giá D1',async f=>{const r=await expect(f.order({items:[{...f.item(),price:1,total:1}],total:1}),201);assert.equal(r.order.total,55000);assert.equal(r.order.items[0].price,55000)}]
]);
group('C · Sốt, combo và topping',[
 ['21 Món không có size không thể ép lên size lớn',async f=>{await expect(f.order({items:[f.item('EC_MAIN001',1,{size:'大'})]}),400,'INVALID_SIZE')}],
 ['22 Món không cay không thể ép mức cay khác',async f=>{await expect(f.order({items:[f.item('EC_MAIN001',1,{spice:'大'})]}),400,'INVALID_SPICE')}],
 ['23 Gà sốt bắt buộc chọn một loại sốt',async f=>{await expect(f.order({items:[f.item('EC_MAIN002')]}),400,'INVALID_MODIFIERS')}],
 ['24 Gà sốt chọn S02 được ghi trong snapshot',async f=>{const r=await expect(f.order({items:[f.item('EC_MAIN002',1,{options:{SAUCE_FRIED_CHICKEN:['S02']}})]}),201);assert.equal(r.order.items[0].mods.options.SAUCE_FRIED_CHICKEN[0].code,'S02')}],
 ['25 Gà sốt không thể chọn hai sốt khi max là một',async f=>{await expect(f.order({items:[f.item('EC_MAIN002',1,{options:{SAUCE_FRIED_CHICKEN:['S01','S02']}})]}),400,'INVALID_MODIFIERS')}],
 ['26 Combo thiếu trà bắt buộc bị từ chối',async f=>{await expect(f.order({items:[f.item('EC_MAIN013',1,{options:{COMBO_RICE_MAIN:['R01']}})]}),400,'INVALID_MODIFIERS')}],
 ['27 Combo đủ cơm và trà giữ hai lựa chọn',async f=>{const r=await expect(f.order({items:[f.item('EC_MAIN013',1,{options:{COMBO_RICE_MAIN:['R02'],COMBO_RICE_DRINK:['D03']}})]}),201);assert.equal(r.order.items[0].mods.options.COMBO_RICE_DRINK[0].code,'D03');assert.equal(r.order.total,120000)}],
 ['28 Topping kem sữa cộng đúng 16.000đ',async f=>{const r=await expect(f.order({items:[f.item('EC_FRUIT001-M',1,{options:{DRINK_TOPPING:['T01']}})]}),201);assert.equal(r.order.total,66000)}],
 ['29 Trùng topping trong một món bị từ chối',async f=>{await expect(f.order({items:[f.item('EC_FRUIT001-M',1,{options:{DRINK_TOPPING:['T01','T01']}})]}),400,'INVALID_MODIFIERS')}],
 ['30 Nhóm topping giả mạo bị từ chối',async f=>{await expect(f.order({items:[f.item('EC_FRUIT001-M',1,{options:{FAKE:['T01']}})]}),400,'INVALID_MODIFIERS')}]
]);
group('D · Hội viên từ điện thoại khách',[
 ['31 Đăng ký số 10 chữ số được cấp phiên',async f=>{const r=await expect(f.call('/api/member/register','POST',{phone:'0912345678',name:'Khách Echo'}),201);assert.equal(r.member.phone,'0912345678');assert.match(r.headers.get('set-cookie'),/HttpOnly/)}],
 ['32 Đăng ký số 11 chữ số được chấp nhận',async f=>{const r=await expect(f.call('/api/member/register','POST',{phone:'09123456789',name:'Khách Echo'}),201);assert.equal(r.member.phone,'09123456789')}],
 ['33 Số 9 chữ số bị từ chối',async f=>{await expect(f.call('/api/member/register','POST',{phone:'091234567',name:'Khách Echo'}),400,'INVALID_MEMBER')}],
 ['34 Số 12 chữ số bị từ chối',async f=>{await expect(f.call('/api/member/register','POST',{phone:'091234567890',name:'Khách Echo'}),400,'INVALID_MEMBER')}],
 ['35 Trùng điện thoại không tạo tài khoản thứ hai',async f=>{await expect(f.call('/api/member/register','POST',{phone:'0912345678',name:'Khách Echo'}),201);await expect(f.call('/api/member/register','POST',{phone:'0912345678',name:'Khách khác'}),409,'PHONE_EXISTS');assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM members').get().n,1)}],
 ['36 Số +84 được chuẩn hóa thành 0 khi đăng ký',async f=>{const r=await expect(f.call('/api/member/register','POST',{phone:'+84912345678',name:'Khách Echo'}),201);assert.equal(r.member.phone,'0912345678')}],
 ['37 Sai mật khẩu không vào được hội viên',async f=>{await f.call('/api/member/register','POST',{phone:'0912345678',name:'Khách Echo'});await expect(f.call('/api/member/login','POST',{phone:'0912345678',password:'incorrect'}),401,'MEMBER_LOGIN_FAILED')}],
 ['38 Mật khẩu ban đầu đúng bằng số điện thoại',async f=>{await f.call('/api/member/register','POST',{phone:'0912345678',name:'Khách Echo'});const r=await expect(f.call('/api/member/login','POST',{phone:'0912345678',password:'0912345678'}),200);assert.equal(r.member.displayName,'Khách Echo')}],
 ['39 Khách đăng nhập đặt món lưu đúng hội viên',async f=>{const r=await f.call('/api/member/register','POST',{phone:'0912345678',name:'Khách Echo'}),cookie=r.headers.get('set-cookie').split(';')[0];const o=await expect(f.order({}, {Cookie:cookie}),201);assert.equal(o.order.memberName,'Khách Echo');assert.equal(f.db.prepare('SELECT member_id FROM qr_orders').get().member_id,r.member.id)}],
 ['40 Khách vãng lai vẫn gọi món mà không gắn hội viên',async f=>{const r=await expect(f.order(),201);assert.equal(r.order.memberName,null);assert.equal(f.db.prepare('SELECT member_id FROM qr_orders').get().member_id,null)}]
]);
group('E · Voucher khi đặt món',[
 ['41 Voucher mẫu chưa kích hoạt không hiện công khai',async f=>{const r=await f.call('/api/vouchers');assert.equal(r.vouchers.length,0)}],
 ['42 Voucher được bật và niêm yết hiện trên QR',async f=>{voucher(f,'PUBLIC10');const r=await f.call('/api/vouchers');assert.ok(r.vouchers.some(x=>x.code==='PUBLIC10'))}],
 ['43 Voucher không tồn tại không làm phát sinh đơn',async f=>{await expect(f.order({voucherCode:'NO_SUCH_CODE'}),400,'INVALID_VOUCHER');assert.equal(value(f),0)}],
 ['44 Giỏ chưa đủ mức tối thiểu không được dùng mã',async f=>{f.db.exec("UPDATE vouchers SET active=1,listed=1 WHERE code='SAVE20'");await expect(f.order({voucherCode:'SAVE20'}),400,'VOUCHER_MIN');assert.equal(value(f),0)}],
 ['45 Mã giảm cố định trừ đúng 20.000đ',async f=>{f.db.exec("UPDATE vouchers SET active=1,listed=1 WHERE code='SAVE20'");const r=await expect(f.order({items:[f.item('EC_MAIN001',3)],voucherCode:'save20'}),201);assert.equal(r.order.subtotal,165000);assert.equal(r.order.discount,20000);assert.equal(r.order.total,145000)}],
 ['46 Mã phần trăm tôn trọng trần giảm',async f=>{voucher(f,'PCT50','PERCENT',50);f.db.exec("UPDATE vouchers SET max_discount=10000 WHERE code='PCT50'");const r=await expect(f.order({voucherCode:'PCT50'}),201);assert.equal(r.order.discount,10000);assert.equal(r.order.total,45000)}],
 ['47 Mã chỉ hội viên yêu cầu đăng nhập',async f=>{f.db.exec("UPDATE vouchers SET active=1,listed=1 WHERE code='WELCOME10'");await expect(f.order({items:[f.item('EC_MAIN013',1,{options:{COMBO_RICE_MAIN:['R01'],COMBO_RICE_DRINK:['D01']}})],voucherCode:'WELCOME10'}),401,'MEMBER_REQUIRED')}],
 ['48 Hội viên chưa OTP không dùng mã yêu cầu xác minh',async f=>{f.db.exec("UPDATE vouchers SET active=1,listed=1 WHERE code='WELCOME10'");const r=await f.call('/api/member/register','POST',{phone:'0912345678',name:'Khách Echo'});await expect(f.order({items:[f.item('EC_MAIN013',1,{options:{COMBO_RICE_MAIN:['R01'],COMBO_RICE_DRINK:['D01']}})],voucherCode:'WELCOME10'},{Cookie:r.headers.get('set-cookie').split(';')[0]}),403,'PHONE_NOT_VERIFIED')}],
 ['49 Voucher hết hạn không còn trong danh sách',async f=>{voucher(f,'EXPIRED');f.db.exec("UPDATE vouchers SET ends_at='2026-01-02T00:00:00Z' WHERE code='EXPIRED'");const r=await f.call('/api/vouchers');assert.ok(!r.vouchers.some(x=>x.code==='EXPIRED'));await expect(f.order({voucherCode:'EXPIRED'}),400,'INVALID_VOUCHER')}],
 ['50 Mã hết lượt vẫn trả lại đơn cũ khi khách thử lại',async f=>{f.db.exec("UPDATE vouchers SET active=1,listed=1,max_uses=1 WHERE code='SAVE20'");const payload={table:'T01',items:[f.item('EC_MAIN001',3)],voucherCode:'SAVE20',idempotencyKey:'voucher_retry_same_cart_0001'};const first=await expect(f.call('/api/orders','POST',payload),201);await expect(f.call('/api/orders','POST',{...payload,idempotencyKey:'voucher_retry_other_cart_0002'}),400,'VOUCHER_FULL');const retry=await expect(f.call('/api/orders','POST',payload),200);assert.equal(retry.duplicate,true);assert.equal(retry.order.id,first.order.id);assert.equal(value(f),1)}]
]);
group('F · Phương thức và chống gửi trùng',[
 ['51 Chuyển khoản mặc định sinh mã kết thúc CK',async f=>{const r=await expect(f.order(),201);assert.match(r.order.code,/-CK$/);assert.equal(r.order.paymentPreference,'BANK')}],
 ['52 Chọn tiền mặt sinh mã kết thúc TM',async f=>{const r=await expect(f.order({paymentPreference:'CASH'}),201);assert.match(r.order.code,/-TM$/);assert.equal(r.order.paymentPreference,'CASH')}],
 ['53 Mã tham chiếu ngân hàng của đơn tiền mặt giữ alias CK',async f=>{const r=await f.order({paymentPreference:'CASH'});assert.equal(r.order.bankPayment.content,r.order.code.replace(/-TM$/,'-CK'))}],
 ['54 Nội dung chuyển khoản đúng mã đơn đầy đủ',async f=>{const r=await f.order({paymentPreference:'BANK'});assert.equal(r.order.bankPayment.content,r.order.code);assert.equal(r.order.bankPayment.amount,r.order.total)}],
 ['55 Gửi lại đúng yêu cầu không nhân đôi đơn',async f=>{const p={table:'T01',items:[f.item()],idempotencyKey:'customer_double_tap_000001'};const a=await expect(f.call('/api/orders','POST',p),201);const b=await expect(f.call('/api/orders','POST',p),200);assert.equal(b.order.id,a.order.id);assert.equal(value(f),1)}],
 ['56 Cùng mã yêu cầu nhưng đổi số lượng bị chặn',async f=>{const p={table:'T01',items:[f.item()],idempotencyKey:'customer_changed_cart_00001'};await f.call('/api/orders','POST',p);await expect(f.call('/api/orders','POST',{...p,items:[f.item('EC_MAIN001',2)]}),409,'REQUEST_ID_REUSED');assert.equal(value(f),1)}],
 ['57 Cùng mã yêu cầu nhưng đổi tiền mặt bị chặn',async f=>{const p={table:'T01',items:[f.item()],idempotencyKey:'customer_changed_pay_000001'};await f.call('/api/orders','POST',p);await expect(f.call('/api/orders','POST',{...p,paymentPreference:'CASH'}),409,'REQUEST_ID_REUSED');assert.equal(value(f),1)}],
 ['58 Thiếu mã chống gửi trùng bị từ chối',async f=>{await expect(f.order({idempotencyKey:''}),400,'INVALID_REQUEST_ID');assert.equal(value(f),0)}],
 ['59 Mã chống gửi trùng quá ngắn bị từ chối',async f=>{await expect(f.order({idempotencyKey:'too-short'}),400,'INVALID_REQUEST_ID');assert.equal(value(f),0)}],
 ['60 Hai yêu cầu khác nhau tạo hai mã đơn khác nhau',async f=>{const a=await f.order(),b=await f.order();assert.notEqual(a.order.id,b.order.id);assert.notEqual(a.order.code,b.order.code);assert.equal(value(f),2)}]
]);
group('G · Theo dõi đơn và gọi nhân viên',[
 ['61 Không có mã truy cập thì khách không xem được đơn',async f=>{const o=await f.order();await expect(f.call('/api/orders/'+o.order.id),400,'INVALID_ORDER_REFERENCE')}],
 ['62 Mã truy cập sai không xem được đơn',async f=>{const o=await f.order();await expect(f.call('/api/orders/'+o.order.id,'GET',undefined,{'x-order-token':'wrong'}),403,'ORDER_ACCESS_DENIED')}],
 ['63 Mã truy cập đúng xem trạng thái chưa trả tiền',async f=>{const o=await f.order();const r=await expect(f.call('/api/orders/'+o.order.id,'GET',undefined,{'x-order-token':o.orderToken}),200);assert.equal(r.order.paymentStatus,'UNPAID')}],
 ['64 Không có mã truy cập không thể gọi nhân viên',async f=>{const o=await f.order();await expect(f.call('/api/orders/'+o.order.id+'/service','POST',{}),400,'INVALID_ORDER_REFERENCE');assert.equal(services(f),0)}],
 ['65 Mã truy cập sai không thể gọi nhân viên',async f=>{const o=await f.order();await expect(f.call('/api/orders/'+o.order.id+'/service','POST',{}, {'x-order-token':'wrong'}),403,'ORDER_ACCESS_DENIED');assert.equal(services(f),0)}],
 ['66 Gọi nhân viên tạo đúng một yêu cầu bàn',async f=>{const o=await f.order({table:'T09'});await expect(f.call('/api/orders/'+o.order.id+'/service','POST',{}, {'x-order-token':o.orderToken}),200);assert.equal(services(f),1);assert.equal(f.db.prepare('SELECT table_id FROM pos_service_requests').get().table_id,'T09')}],
 ['67 Bấm gọi nhân viên lần nữa không tạo popup thứ hai',async f=>{const o=await f.order();for(let i=0;i<2;i++)await expect(f.call('/api/orders/'+o.order.id+'/service','POST',{}, {'x-order-token':o.orderToken}),200);assert.equal(services(f),1)}],
 ['68 Đã thanh toán không thể gửi thêm yêu cầu thu tiền',async f=>{const o=await f.order(),auth=await f.call('/api/staff/login','POST',{password:f.env.POS_STAFF_PASSWORD}),h={Authorization:'Bearer '+auth.token};const accepted=await expect(f.call('/api/staff/orders/'+o.order.id+'/accept','POST',{version:o.order.version},h),200);await expect(f.call('/api/staff/orders/'+o.order.id+'/pay','POST',{version:accepted.order.version,method:'BANK'},h),200);await expect(f.call('/api/orders/'+o.order.id+'/service','POST',{}, {'x-order-token':o.orderToken}),409,'ORDER_ACCESS_DENIED')}],
 ['69 Khách không thể tự báo đã thanh toán qua endpoint cũ',async f=>{const o=await f.order();await expect(f.call('/api/orders/'+o.order.id+'/reported','POST',{}, {'x-order-token':o.orderToken}),404);assert.equal(jobs(f),0)}],
 ['70 Trang ngoài nguồn không thể gọi nhân viên',async f=>{const o=await f.order();await expect(f.call('/api/orders/'+o.order.id+'/service','POST',{}, {'Origin':'https://outside.test','x-order-token':o.orderToken}),403,'ORIGIN_REJECTED');assert.equal(services(f),0)}]
]);

async function customerUI(f,{table='T01',storage=new Map(),online=true}={}){
 const app={innerHTML:''},products={innerHTML:''},hero={innerHTML:''},menuStatus={innerHTML:''},cartStatus={innerHTML:''},listeners={};
 const nodes={'#app':app,'#product-list':products,'#menu-hero':hero,'#menu-connect':menuStatus,'#cart-connect':cartStatus,'#item-note':{value:''}};
 const document={documentElement:{lang:'vi'},body:{style:{},appendChild(){}},hidden:false,activeElement:null,querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,createElement:()=>({download:'',href:'',setAttribute(){},appendChild(){},click(){},remove(){}})};
 const context={document,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},location:{search:'?table='+table,href:'https://pos.test/qr/?table='+table,protocol:'https:',hostname:'pos.test'},history:{replaceState(){}},navigator:{onLine:online},crypto,Response,Request,URL,URLSearchParams,Intl,JSON,Number,Array,String,Math,Date,console,AbortSignal,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,fetch:(path,options={})=>f.raw(path,{...options,headers:{Origin:'https://pos.test',...options.headers}})};
 context.window=context;context.scrollTo=()=>{};context.addEventListener=()=>{};vm.createContext(context);
 vm.runInContext(readFileSync(new URL('../public/assets/qrcode.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8'),context);
 await until(()=>app.innerHTML.includes('data-add="EC_MAIN001"'));
 return{app,products,storage,nodes,click:dataset=>listeners.click({target:{closest:()=>({dataset})}}),input:(id,text)=>listeners.input({target:{id,value:text}})};
}
async function until(check){for(let n=0;n<80;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5))}assert.fail('Customer screen did not reflect the D1 action')}
function choose(ui){ui.click({add:'EC_MAIN001'});ui.click({action:'modal-save'});ui.click({view:'cart'})}
group('H · Thao tác trên trang QR thực tế',[
 ['71 Khách thấy tên Echo, món và danh mục sau khi quét',async f=>{const ui=await customerUI(f);assert.match(ui.app.innerHTML,/Echo Coffee/);assert.match(ui.app.innerHTML,/data-add="EC_MAIN001"/);assert.match(ui.app.innerHTML,/data-cat="Món chính"/)}],
 ['72 Chọn danh mục chỉ hiển thị món thuộc nhóm',async f=>{const ui=await customerUI(f);ui.click({cat:'Món chính'});assert.match(ui.app.innerHTML,/Gà giòn 2 miếng/);assert.doesNotMatch(ui.app.innerHTML,/Trà đào M/)}],
 ['73 Tìm SKU trên menu lọc đúng món',async f=>{const ui=await customerUI(f);ui.input('search','FRUIT001-M');assert.match(ui.products.innerHTML,/Trà đào M/);assert.doesNotMatch(ui.products.innerHTML,/Gà giòn 2 miếng/)}],
 ['74 Chọn món, xác nhận tùy chọn và lưu giỏ theo bàn',async f=>{const ui=await customerUI(f);choose(ui);assert.match(ui.app.innerHTML,/Gà giòn 2 miếng/);assert.equal(JSON.parse(ui.storage.get('lotus-qr-cart:T01'))[0].qty,1)}],
 ['75 Tăng rồi giảm số phần cập nhật giỏ không tạo đơn',async f=>{const ui=await customerUI(f);choose(ui);ui.click({qty:'0',delta:'1'});assert.equal(JSON.parse(ui.storage.get('lotus-qr-cart:T01'))[0].qty,2);ui.click({qty:'0',delta:'-1'});assert.equal(JSON.parse(ui.storage.get('lotus-qr-cart:T01'))[0].qty,1);assert.equal(value(f),0)}],
 ['76 Xóa món khỏi giỏ không tạo đơn trên D1',async f=>{const ui=await customerUI(f);choose(ui);ui.click({remove:'0'});assert.deepEqual(JSON.parse(ui.storage.get('lotus-qr-cart:T01')),[]);assert.equal(value(f),0)}],
 ['77 Khách chọn tiền mặt, gọi món, thấy cảm ơn và popup đến quầy',async f=>{const ui=await customerUI(f);choose(ui);ui.click({paymentChoice:'CASH'});ui.click({action:'submit'});await until(()=>services(f)===1);assert.equal(value(f),1);assert.equal(jobs(f),0);assert.match(ui.app.innerHTML,/Xin cảm ơn quý khách/);assert.equal(f.db.prepare('SELECT payment_status FROM qr_orders').get().payment_status,'UNPAID')}],
 ['78 Khách chọn chuyển khoản, QR khớp mã đơn và chưa phát phiếu bếp',async f=>{const ui=await customerUI(f);choose(ui);ui.click({paymentChoice:'BANK'});ui.click({action:'submit'});await until(()=>value(f)===1&&ui.app.innerHTML.includes('payment-qr-svg'));const o=f.db.prepare('SELECT code,payment_status FROM qr_orders').get();assert.match(ui.app.innerHTML,new RegExp(o.code));assert.equal(o.payment_status,'UNPAID');assert.equal(jobs(f),0)}],
 ['79 Khách chuyển khoản chỉ báo nhân viên, tải lại vẫn giữ đơn',async f=>{const ui=await customerUI(f);choose(ui);ui.click({action:'submit'});await until(()=>ui.app.innerHTML.includes('data-action="request-staff"'));ui.click({action:'request-staff'});await until(()=>services(f)===1);assert.doesNotMatch(ui.app.innerHTML,/data-action="request-staff"/);const saved=JSON.parse(ui.storage.get('lotus-qr-order:T01'));const reload=await customerUI(f,{storage:ui.storage});reload.click({view:'orders'});assert.match(reload.app.innerHTML,new RegExp(saved.order.code));assert.equal(value(f),1);assert.equal(jobs(f),0)}],
 ['80 Mất mạng chỉ xem trước, không gửi đơn thật',async f=>{const ui=await customerUI(f,{online:false});choose(ui);ui.click({action:'submit'});assert.match(ui.app.innerHTML,/DEMO/);assert.equal(value(f),0);assert.equal(JSON.parse(ui.storage.get('lotus-qr-cart:T01')).length,1)}]
]);

assert.equal(cases.length,8);
assert.equal(cases.reduce((n,g)=>n+g.entries.length,0),80);
for(const {name,entries} of cases)test(name,async t=>{
 for(const [title,run] of entries)await t.test(title,async()=>{const f=fixture();try{await run(f)}finally{f.db.close()}});
});
