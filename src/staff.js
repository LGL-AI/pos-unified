// Server-owned POS ledger. The browser and the SUNMI use this same API.
import {allowed,handleOps,loginActor,sessionActor} from './ops.js';
import {displayStaff} from './display.js';
import {handleManagement} from './management.js';
import {settingsStaff} from './settings.js';
import {daily} from './reports.js';
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const result=(data,status=200)=>new Response(JSON.stringify({ok:true,...data}),{status,headers:H});
const error=(status,code,message)=>new Response(JSON.stringify({ok:false,code,message}),{status,headers:H});
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const now=()=>new Date().toISOString();
const safe=(x,n=300)=>typeof x==='string'?x.trim().slice(0,n):'';
const money=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000?n:null;
export function tierFor(points){return points>=600?'Platinum':points>=300?'Gold':points>=100?'Silver':'Member'}
function tlv(tag,value){return tag+String(value.length).padStart(2,'0')+value}
function crc16(s){let c=0xffff;for(let i=0;i<s.length;i++){c^=s.charCodeAt(i)<<8;for(let j=0;j<8;j++)c=(c&0x8000)?(c<<1)^0x1021:c<<1;c&=0xffff}return c.toString(16).toUpperCase().padStart(4,'0')}
export function paymentFor(row){
 if(!/^\d{6}$/.test(row.bank_bin||'')||!/^\d{6,24}$/.test(row.bank_account||'')||!row.bank_name)return null;
 const billSuffix=String(row.code||'').match(/ B([1-9]\d*)$/)?.[1],suffix=billSuffix?'B'+billSuffix:'';
 const prefix=(row.transfer_prefix||'PT').replace(/[^A-Za-z0-9]/g,''),code=String(row.code||'').replace(/ B[1-9]\d*$/,'').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
 const content=(prefix+' '+code.slice(-(25-prefix.length-1-suffix.length))+suffix).slice(0,25);
 const bank=tlv('00',row.bank_bin)+tlv('01',row.bank_account);
 const merchant=tlv('00','A000000727')+tlv('01',bank)+tlv('02','QRIBFTTA');
 const raw=tlv('00','01')+tlv('01','12')+tlv('38',merchant)+tlv('53','704')+tlv('54',String(row.total))+tlv('58','VN')+tlv('62',tlv('08',content))+'6304';
 return {payload:raw+crc16(raw),amount:row.total,account:row.bank_account,accountName:row.bank_name,bankBin:row.bank_bin,bankLabel:row.bank_label||'',content};
}
function bill(row,order){const b={id:row.id,orderId:row.order_id,sequence:row.sequence,items:JSON.parse(row.items_json),subtotal:row.subtotal,discount:row.discount,total:row.total,taxAmount:row.tax_amount||0,taxMode:order.tax_mode||'INCLUSIVE',taxRate:order.tax_rate||0,paymentStatus:row.payment_status,paymentMethod:row.payment_method,cashReceived:row.cash_received,cashChange:row.cash_change,paidAt:row.paid_at,refundedAmount:row.refunded_amount||0};b.bankPayment=paymentFor({...order,code:order.code+' B'+row.sequence,total:row.total});return b}
function editable(row,version){if(!row)return error(404,'ORDER_NOT_FOUND','Không tìm thấy đơn');if(row.status!=='ACCEPTED'||row.payment_status==='PAID')return error(409,'ORDER_CLOSED','Đơn đã đóng hoặc cần nhân viên nhận trước');if(row.version!==version)return error(409,'ORDER_CHANGED','Đơn vừa được thay đổi trên thiết bị khác. Tải lại trước khi thao tác');return null}
async function getRow(env,id){return env.DB.prepare('SELECT * FROM qr_orders WHERE id=?').bind(id).first()}
async function memberById(env,id){return id?env.DB.prepare('SELECT id,display_name,phone_verified,phone,points FROM members WHERE id=?').bind(id).first():null}
function discounted(subtotal,v){if(!v)return 0;const raw=v.kind==='PERCENT'?Math.floor(subtotal*v.value/100):v.value;return Math.min(subtotal,v.max_discount>0?Math.min(raw,v.max_discount):raw)}
async function overview(env,hydrate,id){const row=await getRow(env,id);if(!row)return error(404,'ORDER_NOT_FOUND','Không tìm thấy đơn');const {results:jobs=[]}=await env.DB.prepare('SELECT * FROM pos_kitchen_jobs WHERE order_id=? ORDER BY revision').bind(id).all();const {results:bills=[]}=await env.DB.prepare('SELECT b.*,COALESCE((SELECT SUM(amount) FROM pos_refunds WHERE bill_id=b.id),0) AS refunded_amount FROM pos_bills b WHERE order_id=? ORDER BY sequence').bind(id).all();const earned=await env.DB.prepare('SELECT points FROM loyalty_transactions WHERE order_id=?').bind(id).first();const refunded=await env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM pos_refunds WHERE order_id=?').bind(id).first();return result({order:{...hydrate(row),pointsEarned:earned?.points??null,refundedAmount:refunded?.amount||0},jobs:jobs.map(x=>({id:x.id,revision:x.revision,kind:x.kind,status:x.status,items:JSON.parse(x.items_json),createdAt:x.created_at})),bills:bills.map(x=>bill(x,row))})}
async function resolveStaffVoucher(env,deps,code,subtotal,member){return code?deps.resolveVoucher(env,code,subtotal,member,now()):null}
export async function handleStaff(req,env,deps){
 const rawPath=new URL(req.url).pathname;
 // URL.pathname retains %3A for kitchen job and split bill IDs from browsers/Android.
 const path=rawPath.replace(/^\/api\/staff\/jobs\/(kitchen%3A[a-f0-9-]{36}%3A\d+)(\/(?:claim|status))$/i,(_,job,suffix)=>'/api/staff/jobs/'+decodeURIComponent(job)+suffix)
  .replace(/^\/api\/staff\/bills\/([a-f0-9-]{36}%3A[1-9]\d*)(\/pay)$/i,(_,bill,suffix)=>'/api/staff/bills/'+decodeURIComponent(bill)+suffix);
 const method=req.method;
 try{
  if(!['GET','HEAD','OPTIONS'].includes(method)&&!deps.originValid(req))return error(403,'ORIGIN_REJECTED','Nguồn yêu cầu không hợp lệ');
  if(!(await deps.ready(env)))return error(503,'DB_UNAVAILABLE','D1 hoặc SESSION_SECRET chưa được cấu hình');
  if(path==='/api/staff/login'&&method==='POST'){
   if(!await deps.rate(env,req,'staff-login',8))return error(429,'TOO_MANY_ATTEMPTS','Thử lại sau 15 phút');
   const credentials=await deps.body(req),pw=credentials.password;
   if(typeof env.POS_STAFF_PASSWORD!=='string'||env.POS_STAFF_PASSWORD.length<6)return error(503,'STAFF_NOT_CONFIGURED','Cần cấu hình POS_STAFF_PASSWORD trong Cloudflare');
   if(typeof pw!=='string'||pw.length<6||pw.length>128)return error(401,'LOGIN_FAILED','Tài khoản hoặc mật khẩu POS không đúng');
   const identity=await loginActor(env,credentials.username,pw,deps);if(!identity)return error(401,'LOGIN_FAILED','Tài khoản hoặc mật khẩu POS không đúng');
   const token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   await env.DB.prepare('INSERT INTO pos_staff_sessions(token_hash,expires_at,staff_id) VALUES(?,?,?)').bind(await deps.sha(token),Date.now()+12*3600000,identity.staffId).run();
   return result({token,expiresAt:Date.now()+12*3600000,staff:identity.actor});
  }
  const token=(req.headers.get('Authorization')||'').match(/^Bearer ([A-Za-z0-9_-]{32,100})$/)?.[1];
  const actor=token?await sessionActor(env,token,deps.sha):null;
  if(!actor)return error(401,'STAFF_LOGIN_REQUIRED','Đăng nhập POS để tiếp tục');
  if(path==='/api/staff/me'&&method==='GET')return result({staff:actor});
  if(path==='/api/staff/logout'&&method==='POST'){await env.DB.prepare('DELETE FROM pos_staff_sessions WHERE token_hash=?').bind(await deps.sha(req.headers.get('Authorization').slice(7))).run();return result({})}
  if(path.startsWith('/api/staff/display'))return await displayStaff(req,env,actor,deps);
  if((path==='/api/staff/summary'||path==='/api/staff/reports/daily')&&method==='GET'){
   if(!allowed(actor,'ORDER_VIEW'))return error(403,'PERMISSION_DENIED','Không có quyền xem báo cáo');
   const data=await daily(env,new URL(req.url).searchParams.get('date'));
   if(!data)return error(400,'INVALID_DATE','Ngày báo cáo không hợp lệ');
   if(path==='/api/staff/summary'){const {payments,refunds,...summary}=data;return result({summary})}
   return result({report:data});
  }
  const settings=await settingsStaff(req,env,actor,deps.body);if(settings)return settings;
  const management=await handleManagement(req,env,actor,deps);if(management)return management;
  const ops=await handleOps(req,env,actor,deps);if(ops)return ops;
  const permission=path.startsWith('/api/staff/jobs/')?'PRINT_KITCHEN':path.match(/^\/api\/staff\/bills\/.*\/pay$/)?'PAYMENT_CONFIRM':
   path==='/api/staff/orders'&&method==='GET'||/^\/api\/staff\/orders\/[0-9a-f-]{36}$/i.test(path)&&method==='GET'?'ORDER_VIEW':
   path.match(/^\/api\/staff\/orders\/[0-9a-f-]{36}\/pay$/i)?'PAYMENT_CONFIRM':
   path==='/api/staff/members'&&method==='GET'?'ORDER_VIEW':'ORDER_EDIT';
  if(!allowed(actor,permission))return error(403,'PERMISSION_DENIED','Tài khoản không có quyền thực hiện thao tác này');
  if(path==='/api/staff/orders'&&method==='GET'){
   const code=new URL(req.url).searchParams.get('code');if(code!==null&&!/^PT-[0-9A-F-]{12,40}$/i.test(code))return error(400,'INVALID_CODE','Mã đơn không hợp lệ');
   const {results:rows=[]}=await (code?env.DB.prepare('SELECT * FROM qr_orders WHERE code=? ORDER BY created_at DESC LIMIT 1').bind(code):env.DB.prepare('SELECT * FROM qr_orders ORDER BY created_at DESC LIMIT 100')).all();
   return result({orders:rows.map(deps.hydrate)});
  }
  if(path==='/api/staff/members'&&method==='GET'){const phone=new URL(req.url).searchParams.get('phone')||'';if(!/^0\d{9}$/.test(phone))return error(400,'INVALID_PHONE','Nhập số điện thoại 10 chữ số');const member=await env.DB.prepare('SELECT id,display_name,phone,points,spend,orders,last_visit,phone_verified FROM members WHERE phone=?').bind(phone).first();return result({member:member?{id:member.id,name:member.display_name,phone:member.phone,points:member.points,tier:tierFor(member.points),spend:member.spend,orders:member.orders,lastVisit:member.last_visit,phoneVerified:!!member.phone_verified}:null})}
  if(path==='/api/staff/members/register'&&method==='POST')return deps.register(env,req);
  if(path==='/api/staff/members/login'&&method==='POST')return deps.login(env,req);
  if(path==='/api/staff/voucher'&&method==='POST'){const b=await deps.body(req),v=await deps.calculate(b,env),member=await memberById(env,b.memberId);if(b.memberId&&!member)return error(400,'INVALID_MEMBER','Không thấy hội viên');const offer=await resolveStaffVoucher(env,deps,b.voucherCode,v.subtotal,member);return result({...deps.priceTotals(v.subtotal,offer?.discount||0,await deps.getStore(env)),voucher:offer?.code||null})}
  if(path==='/api/staff/orders'&&method==='POST'){
   if(env.ORDERING_ENABLED!=='true')return error(503,'ORDERING_DISABLED','Cửa hàng chưa bật nhận đơn');
   const b=await deps.body(req),idem=b.idempotencyKey;
   if(typeof idem!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(idem))return error(400,'INVALID_REQUEST_ID','Mã yêu cầu không hợp lệ');
   const member=await memberById(env,b.memberId),vc=safe(b.voucherCode,32).toUpperCase();if(b.memberId&&!member)return error(400,'INVALID_MEMBER','Không thấy hội viên');
   const fingerprint=await deps.sha(JSON.stringify({table:safe(b.table,20).toUpperCase(),items:b.items,note:safe(b.note,300),memberId:member?.id||null,voucherCode:vc}));
   const prior=await env.DB.prepare('SELECT * FROM qr_orders WHERE idem_key=?').bind(idem).first();if(prior)return prior.fingerprint===fingerprint?result({order:deps.hydrate(prior),duplicate:true}):error(409,'REQUEST_ID_REUSED','Mã đơn đã dùng cho giỏ khác');
   const value=await deps.calculate(b,env);const offer=await resolveStaffVoucher(env,deps,vc,value.subtotal,member),setting=await deps.getStore(env),amounts=deps.priceTotals(value.subtotal,offer?.discount||0,setting),id=crypto.randomUUID(),time=now(),code='PT-'+time.slice(2,10).replaceAll('-','')+'-'+id.replaceAll('-','').slice(0,10).toUpperCase();
   await env.DB.prepare(`INSERT INTO qr_orders(id,idem_key,fingerprint,token_hash,code,table_id,items_json,subtotal,discount,total,note,member_id,member_name,voucher_id,voucher_code,status,payment_status,source,version,kitchen_revision,created_at,updated_at,bank_bin,bank_account,bank_name,bank_label,inventory_tracked,voucher_terms_json,tax_mode,tax_rate,tax_amount,transfer_prefix) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'ACCEPTED','UNPAID','POS',1,1,?,?,?,?,?,?,1,?,?,?,?,?) ON CONFLICT(idem_key) DO NOTHING`).bind(id,idem,fingerprint,'STAFF_ONLY',code,value.table,JSON.stringify(value.items),value.subtotal,offer?.discount||0,amounts.total,value.note,member?.id||null,member?.display_name||null,offer?.id||null,offer?.code||null,time,time,...deps.bankSnapshot(setting),offer?JSON.stringify({kind:offer.kind,value:offer.value,max_discount:offer.max_discount,min_spend:offer.min_spend}):null,amounts.taxMode,amounts.taxRate,amounts.taxAmount,setting.transfer_prefix).run();
   const row=await env.DB.prepare('SELECT * FROM qr_orders WHERE idem_key=?').bind(idem).first();if(!row)return error(503,'ORDER_NOT_SAVED','Chưa lưu được đơn');if(row.fingerprint!==fingerprint)return error(409,'REQUEST_ID_REUSED','Mã đơn đã dùng cho giỏ khác');return result({order:deps.hydrate(row),duplicate:row.id!==id},row.id===id?201:200);
  }
  const orderPath=path.match(/^\/api\/staff\/orders\/([a-f0-9-]{36})(?:\/(accept|append|cancel-unit|cancel|pay|split|merge-bills))?$/i);
  if(orderPath){const id=orderPath[1],action=orderPath[2];if(!uuid(id))return error(400,'INVALID_ID','Mã đơn không hợp lệ');if(method==='GET'&&!action)return overview(env,deps.hydrate,id);if(method!=='POST')return error(405,'METHOD_NOT_ALLOWED','Yêu cầu POST');const b=await deps.body(req),row=await getRow(env,id);
   if(!row)return error(404,'ORDER_NOT_FOUND','Không tìm thấy đơn');
   if(action==='accept'){
    if(row.status==='ACCEPTED')return overview(env,deps.hydrate,id);
    if(row.status!=='NEW'||row.version!==b.version)return error(409,'ORDER_CHANGED','Đơn đã đổi trạng thái, tải lại');
    const r=await env.DB.prepare("UPDATE qr_orders SET status='ACCEPTED',kitchen_revision=1,version=version+1,updated_at=? WHERE id=? AND status='NEW' AND version=?").bind(now(),id,b.version).run();return r.meta.changes?overview(env,deps.hydrate,id):error(409,'ORDER_CHANGED','Tải lại đơn');
   }
   if(action==='merge-bills'){
    if(row.status!=='SPLIT'||row.version!==b.version||!Array.isArray(b.billIds)||b.billIds.length!==2||b.billIds[0]===b.billIds[1])return error(409,'BILL_CHANGED','Chỉ gộp hai bill chưa thanh toán của cùng một đơn');
    const [first,second]=await Promise.all(b.billIds.map(x=>env.DB.prepare('SELECT * FROM pos_bills WHERE id=? AND order_id=?').bind(x,id).first()));
    if(!first||!second||first.payment_status!=='UNPAID'||second.payment_status!=='UNPAID')return error(409,'BILL_CHANGED','Bill đã được thanh toán hoặc không cùng đơn');
    const items=[...JSON.parse(first.items_json),...JSON.parse(second.items_json)],time=now(),marker=JSON.stringify({merge:crypto.randomUUID(),billIds:b.billIds});
    const updates=[env.DB.prepare("UPDATE qr_orders SET version=version+1,updated_at=?,last_change_kind='MERGE',last_delta_json=? WHERE id=? AND version=? AND status='SPLIT' AND (SELECT COUNT(*) FROM pos_bills WHERE order_id=? AND id IN (?,?) AND payment_status='UNPAID')=2").bind(time,marker,id,b.version,id,first.id,second.id),env.DB.prepare("UPDATE pos_bills SET items_json=?,subtotal=?,discount=?,tax_amount=?,total=? WHERE id=? AND order_id=? AND payment_status='UNPAID' AND EXISTS(SELECT 1 FROM pos_bills s WHERE s.id=? AND s.order_id=? AND s.payment_status='UNPAID') AND EXISTS(SELECT 1 FROM qr_orders o WHERE o.id=? AND o.version=? AND o.last_delta_json=?)").bind(JSON.stringify(items),first.subtotal+second.subtotal,first.discount+second.discount,(first.tax_amount||0)+(second.tax_amount||0),first.total+second.total,first.id,id,second.id,id,id,b.version+1,marker),env.DB.prepare("DELETE FROM pos_bills WHERE id=? AND order_id=? AND payment_status='UNPAID' AND EXISTS(SELECT 1 FROM qr_orders o WHERE o.id=? AND o.version=? AND o.last_delta_json=?) AND EXISTS(SELECT 1 FROM pos_bills f WHERE f.id=? AND f.payment_status='UNPAID' AND f.total=?)").bind(second.id,id,id,b.version+1,marker,first.id,first.total+second.total)];
    const results=await env.DB.batch(updates);if(results.some(x=>(x.meta?.changes??x.changes)!==1))return error(409,'BILL_CHANGED','Bill vừa thay đổi; tải lại trước khi gộp');return overview(env,deps.hydrate,id);
   }
   const bad=editable(row,b.version);if(bad)return bad;
   if(row.payment_status==='CUSTOMER_REPORTED'&&action!=='pay')return error(409,'CUSTOMER_REPORTED','Khách đã báo chuyển khoản; kiểm tra tiền vào trước khi thay đổi món hoặc tách bill');
   if(action==='append'){
    const add=await deps.calculate({table:row.table_id,items:b.items,note:''},env),items=JSON.parse(row.items_json).concat(add.items);if(items.length>80||items.reduce((n,x)=>n+x.qty,0)>120)return error(400,'TOO_MANY_ITEMS','Đơn vượt giới hạn món');
    const subtotal=row.subtotal+add.subtotal,v=row.voucher_terms_json?JSON.parse(row.voucher_terms_json):row.voucher_id?await env.DB.prepare('SELECT * FROM vouchers WHERE id=?').bind(row.voucher_id).first():null,discount=row.voucher_id&&!row.voucher_terms_json?Math.min(subtotal,row.discount):discounted(subtotal,v);
    const totals=deps.priceTotals(subtotal,discount,row),time=now();const r=await env.DB.prepare("UPDATE qr_orders SET items_json=?,subtotal=?,discount=?,total=?,tax_amount=?,last_delta_json=?,last_change_kind='ADD',payment_status='UNPAID',inventory_tracked=1,kitchen_revision=kitchen_revision+1,version=version+1,updated_at=? WHERE id=? AND status='ACCEPTED' AND version=? AND payment_status IN ('UNPAID','CUSTOMER_REPORTED')").bind(JSON.stringify(items),subtotal,discount,totals.total,totals.taxAmount,JSON.stringify(add.items),time,id,b.version).run();return r.meta.changes?overview(env,deps.hydrate,id):error(409,'ORDER_CHANGED','Tải lại đơn');
   }
   if(action==='cancel-unit'){
    const items=JSON.parse(row.items_json),index=b.index;if(!Number.isSafeInteger(index)||index<0||index>=items.length)return error(400,'INVALID_ITEM','Món không hợp lệ');const reason=safe(b.reason,120);if(!reason)return error(400,'REASON_REQUIRED','Cần ghi lý do hủy');
    const delta={...items[index],qty:1,mods:{...items[index].mods,note:(items[index].mods?.note||'')+' HỦY: '+reason}};items[index].qty--;if(!items[index].qty)items.splice(index,1);
    const subtotal=items.reduce((s,x)=>s+x.qty*x.price,0);const v=row.voucher_terms_json?JSON.parse(row.voucher_terms_json):row.voucher_id?await env.DB.prepare('SELECT * FROM vouchers WHERE id=?').bind(row.voucher_id).first():null;if(v&&row.voucher_terms_json&&subtotal>0&&subtotal<v.min_spend)return error(409,'VOUCHER_MIN','Hủy món làm đơn không đủ điều kiện voucher; hãy xử lý ưu đãi trước');const discount=row.voucher_id&&!row.voucher_terms_json?Math.min(subtotal,row.discount):discounted(subtotal,v),totals=deps.priceTotals(subtotal,discount,row),time=now();
    const r=await env.DB.prepare("UPDATE qr_orders SET items_json=?,subtotal=?,discount=?,total=?,tax_amount=?,last_delta_json=?,last_change_kind='CANCEL',payment_status='UNPAID',kitchen_revision=kitchen_revision+1,version=version+1,updated_at=?,status=CASE WHEN ?=0 THEN 'CANCELLED' ELSE status END WHERE id=? AND status='ACCEPTED' AND version=? AND payment_status IN ('UNPAID','CUSTOMER_REPORTED')").bind(JSON.stringify(items),subtotal,discount,totals.total,totals.taxAmount,JSON.stringify([delta]),time,items.length,id,b.version).run();return r.meta.changes?overview(env,deps.hydrate,id):error(409,'ORDER_CHANGED','Tải lại đơn');
   }
   if(action==='cancel'){
    if(!safe(b.reason,120))return error(400,'REASON_REQUIRED','Cần ghi lý do hủy');
    const time=now();const r=await env.DB.prepare("UPDATE qr_orders SET status='CANCELLED',version=version+1,updated_at=?,last_change_kind='CANCEL',last_delta_json=items_json,kitchen_revision=kitchen_revision+1,items_json='[]',subtotal=0,discount=0,total=0,tax_amount=0 WHERE id=? AND status='ACCEPTED' AND version=? AND payment_status IN ('UNPAID','CUSTOMER_REPORTED')").bind(time,id,b.version).run();return r.meta.changes?overview(env,deps.hydrate,id):error(409,'ORDER_CHANGED','Tải lại đơn');
   }
   if(action==='pay'){
    const method=b.method;if(!['CASH','BANK'].includes(method))return error(400,'PAYMENT_METHOD','Chọn tiền mặt hoặc chuyển khoản');if(method==='BANK'&&!paymentFor(row))return error(409,'BANK_NOT_CONFIGURED','Chưa cấu hình tài khoản nhận tiền');if(method==='CASH'&&(!Number.isSafeInteger(b.received)||b.received<row.total))return error(400,'CASH_INSUFFICIENT','Số tiền nhận không đủ');
    const time=now(),r=await env.DB.prepare("UPDATE qr_orders SET payment_status='PAID',payment_method=?,cash_received=?,cash_change=?,status='PAID',paid_at=?,updated_at=?,version=version+1 WHERE id=? AND status='ACCEPTED' AND version=? AND payment_status IN ('UNPAID','CUSTOMER_REPORTED')").bind(method,method==='CASH'?b.received:null,method==='CASH'?b.received-row.total:null,time,time,id,b.version).run();return r.meta.changes?overview(env,deps.hydrate,id):error(409,'ORDER_CHANGED','Tải lại đơn');
   }
   if(action==='split'){
    const old=JSON.parse(row.items_json),parts=b.parts,units=old.reduce((s,x)=>s+x.qty,0);
    if(!Array.isArray(parts)||parts.length<2||parts.length>units||parts.length>60)return error(400,'INVALID_SPLIT','Số bill phải từ 2 đến số phần ăn');
    const counts=Array(old.length).fill(0),nowTime=now();let remainingDiscount=row.discount,remainingSubtotal=row.subtotal,remainingTax=row.tax_amount||0;
    const entries=parts.map((part,seq)=>{
     if(!Array.isArray(part)||!part.length)throw Error('INVALID_SPLIT');let subtotal=0;
     const items=part.map(x=>{if(!Number.isSafeInteger(x.index)||!Number.isSafeInteger(x.qty)||x.index<0||x.index>=old.length||x.qty<1)throw Error('INVALID_SPLIT');counts[x.index]+=x.qty;subtotal+=old[x.index].price*x.qty;return {...old[x.index],qty:x.qty}});
     const discount=seq===parts.length-1?remainingDiscount:Math.floor(remainingDiscount*subtotal/remainingSubtotal);remainingDiscount-=discount;remainingSubtotal-=subtotal;
     const taxAmount=seq===parts.length-1?remainingTax:Math.min(remainingTax,Math.floor((row.tax_amount||0)*(subtotal-discount)/Math.max(1,row.subtotal-row.discount)));remainingTax-=taxAmount;return {id:id+':'+(seq+1),items,subtotal,discount,taxAmount,total:subtotal-discount+(row.tax_mode==='EXCLUSIVE'?taxAmount:0),seq:seq+1};
    });
    if(counts.some((n,i)=>n!==old[i].qty)||entries.some(x=>x.total<0)||entries.reduce((s,x)=>s+x.total,0)!==row.total||entries.reduce((s,x)=>s+x.taxAmount,0)!==row.tax_amount)return error(400,'INVALID_SPLIT','Mỗi phần ăn phải thuộc đúng một bill');
    const statements=entries.map(x=>env.DB.prepare('INSERT INTO pos_bills(id,order_id,sequence,items_json,subtotal,discount,total,tax_amount,created_at,expected_version) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(x.id,id,x.seq,JSON.stringify(x.items),x.subtotal,x.discount,x.total,x.taxAmount,nowTime,b.version));
    statements.push(env.DB.prepare("UPDATE qr_orders SET status='SPLIT',version=version+1,updated_at=? WHERE id=? AND status='ACCEPTED' AND version=?").bind(nowTime,id,b.version));
    await env.DB.batch(statements);return overview(env,deps.hydrate,id);
   }
   return error(404,'NOT_FOUND','Chức năng không tồn tại');
  }
  const billPath=path.match(/^\/api\/staff\/bills\/([a-f0-9-]{36}:[1-9]\d*)\/pay$/i);
  if(billPath&&method==='POST'){
   const b=await deps.body(req),id=billPath[1],v=await env.DB.prepare('SELECT b.*,o.bank_bin,o.bank_account,o.bank_name,o.bank_label,o.code,o.status,o.transfer_prefix FROM pos_bills b JOIN qr_orders o ON o.id=b.order_id WHERE b.id=?').bind(id).first();
   if(!v)return error(404,'BILL_NOT_FOUND','Không tìm thấy bill');if(v.status!=='SPLIT'||v.payment_status!=='UNPAID')return error(409,'BILL_CLOSED','Bill đã thanh toán hoặc đóng');
   if(!['CASH','BANK'].includes(b.method))return error(400,'PAYMENT_METHOD','Chọn phương thức thanh toán');if(b.method==='BANK'&&!paymentFor({...v,code:v.code+' B'+v.sequence}))return error(409,'BANK_NOT_CONFIGURED','Chưa cấu hình ngân hàng');if(b.method==='CASH'&&(!Number.isSafeInteger(b.received)||b.received<v.total))return error(400,'CASH_INSUFFICIENT','Tiền mặt chưa đủ');
   const r=await env.DB.prepare("UPDATE pos_bills SET payment_status='PAID',payment_method=?,cash_received=?,cash_change=?,paid_at=? WHERE id=? AND payment_status='UNPAID'").bind(b.method,b.method==='CASH'?b.received:null,b.method==='CASH'?b.received-v.total:null,now(),id).run();return r.meta.changes?overview(env,deps.hydrate,v.order_id):error(409,'BILL_CHANGED','Bill vừa thay đổi');
  }
  const claimPath=path.match(/^\/api\/staff\/jobs\/(kitchen:[a-f0-9-]{36}:\d+)\/claim$/i);
  if(claimPath&&method==='POST'){
   const time=now(),stale=new Date(Date.now()-90000).toISOString();
   const r=await env.DB.prepare("UPDATE pos_kitchen_jobs SET status='CLAIMED',updated_at=? WHERE id=? AND (status IN ('PENDING','FAILED') OR (status='CLAIMED' AND updated_at<?))").bind(time,claimPath[1],stale).run();
   return r.meta.changes?result({status:'CLAIMED'}):error(409,'JOB_ALREADY_SENT','Phiếu đã được thiết bị khác nhận hoặc gửi; kiểm tra giấy trước khi in lại');
  }
  const jobPath=path.match(/^\/api\/staff\/jobs\/(kitchen:[a-f0-9-]{36}:\d+)\/status$/i);
  if(jobPath&&method==='POST'){
   const b=await deps.body(req);if(!['SENT','FAILED','UNKNOWN','CONFIRMED'].includes(b.status))return error(400,'INVALID_STATUS','Trạng thái phiếu không hợp lệ');
   const r=await env.DB.prepare("UPDATE pos_kitchen_jobs SET status=?,updated_at=? WHERE id=? AND (status='PENDING' OR status='CLAIMED' OR status='SENT' OR status='FAILED' OR status='UNKNOWN' OR status=?)").bind(b.status,now(),jobPath[1],b.status).run();return r.meta.changes?result({status:b.status}):error(409,'JOB_CHANGED','Phiếu đã được thiết bị khác xử lý');
  }
  return error(404,'NOT_FOUND','Đường dẫn không tồn tại');
 }catch(e){
  if(['INVALID_TABLE','INVALID_CART','INVALID_ITEM','UNAVAILABLE_PRODUCT','INVALID_QUANTITY','TOO_MANY_ITEMS','INVALID_MODIFIERS','INVALID_SIZE','INVALID_SPICE','INVALID_TOTAL','INVALID_SPLIT','BAD_CONTENT_TYPE','BAD_JSON','BODY_TOO_LARGE'].includes(e?.message))return error(400,e.message,'Dữ liệu không hợp lệ');
  if(['INVALID_VOUCHER','MEMBER_REQUIRED','PHONE_NOT_VERIFIED','VOUCHER_MIN','VOUCHER_FULL','VOUCHER_MEMBER_LIMIT','VOUCHER_UNAVAILABLE','ORDER_CHANGED'].includes(e?.message))return error(409,e.message,'Voucher hoặc đơn đã thay đổi; tải lại');
  if(['OUT_OF_STOCK','INGREDIENT_OUT_OF_STOCK'].includes(e?.message))return error(409,e.message,'Kho không đủ để ghi đơn hoặc thêm món; cập nhật tồn kho trước');
  console.error('Staff API:',e?.message);return error(503,'SERVICE_UNAVAILABLE','Máy chủ tạm gián đoạn; kiểm tra lại đơn trước khi thử lại');
 }
}
