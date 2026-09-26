import {allowed} from './ops.js';

const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const ok=(data,status=200)=>new Response(JSON.stringify({ok:true,...data}),{status,headers:H});
const bad=(status,code,message)=>new Response(JSON.stringify({ok:false,code,message}),{status,headers:H});
const deny=()=>bad(403,'PERMISSION_DENIED','Tài khoản không có quyền thao tác');
const txt=(s,n)=>typeof s==='string'?s.trim().slice(0,n):'';
const integer=(x,max=100000000)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const clock=x=>typeof x==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
const iso=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&!Number.isNaN(Date.parse(x));
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const vietnamDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const check=(condition,code)=>{if(!condition)throw Error(code)};
const rowProduct=p=>({id:p.id,sku:p.sku,name:p.name,nameCn:p.name_cn,category:p.category,station:p.station,price:p.price,largePrice:p.large_price,active:!!p.active,icon:p.icon,size:!!p.size,spicy:!!p.spicy,version:p.version});
const voucherPublic=v=>({id:v.id,code:v.code,titleVi:v.title_vi,titleZh:v.title_zh,kind:v.kind,value:v.value,minSpend:v.min_spend,maxDiscount:v.max_discount,memberOnly:!!v.member_only,active:!!v.active,listed:!!v.listed,startsAt:v.starts_at,endsAt:v.ends_at,maxUses:v.max_uses,used:v.reserved_count+v.redeemed_count,perMemberLimit:v.per_member_limit});

function parseProduct(b,creating){
 const p={id:txt(b.id,24),sku:txt(b.sku,32).toUpperCase(),name:txt(b.name,100),nameCn:txt(b.nameCn,100),category:txt(b.category,50),station:b.station,price:b.price,largePrice:b.largePrice,icon:txt(b.icon,8)||'🍚',size:b.size,spicy:b.spicy,active:b.active};
 check(!creating||/^[A-Za-z0-9_-]{1,24}$/.test(p.id),'INVALID_PRODUCT');
 check(/^[A-Z0-9_-]{2,32}$/.test(p.sku)&&p.name&&p.category&&['KITCHEN','BAR'].includes(p.station)&&integer(p.price)&&integer(p.largePrice)&&p.largePrice>=p.price&&typeof p.size==='boolean'&&typeof p.spicy==='boolean'&&typeof p.active==='boolean'&&(p.size||p.largePrice===p.price),'INVALID_PRODUCT');
 return p;
}
function parseVoucher(b){
 const v={code:txt(b.code,32).toUpperCase(),titleVi:txt(b.titleVi,100),titleZh:txt(b.titleZh,100),kind:b.kind,value:b.value,minSpend:b.minSpend,maxDiscount:b.maxDiscount,memberOnly:b.memberOnly,active:b.active,listed:b.listed,startsAt:b.startsAt,endsAt:b.endsAt,maxUses:b.maxUses,perMemberLimit:b.perMemberLimit};
 check(/^[A-Z0-9_-]{3,32}$/.test(v.code)&&v.titleVi&&['PERCENT','FIXED'].includes(v.kind)&&integer(v.value)&&v.value>0&&(v.kind!=='PERCENT'||v.value<=100)&&integer(v.minSpend)&&integer(v.maxDiscount)&&integer(v.maxUses,1000000)&&integer(v.perMemberLimit,1000000)&&typeof v.memberOnly==='boolean'&&typeof v.active==='boolean'&&typeof v.listed==='boolean'&&iso(v.startsAt)&&iso(v.endsAt)&&v.startsAt<v.endsAt,'INVALID_VOUCHER_CONFIG');
 return v;
}
async function cashOverview(env){
 const shift=await env.DB.prepare("SELECT * FROM pos_cash_shifts WHERE status='OPEN'").first();
 if(!shift)return {shift:null};
 const [orders,bills,refunds]=await Promise.all([
  env.DB.prepare("SELECT COALESCE(SUM(total),0) AS cash FROM qr_orders o WHERE status='PAID' AND payment_method='CASH' AND paid_at>=? AND NOT EXISTS(SELECT 1 FROM pos_bills b WHERE b.order_id=o.id)").bind(shift.opened_at).first(),
  env.DB.prepare("SELECT COALESCE(SUM(total),0) AS cash FROM pos_bills WHERE payment_status='PAID' AND payment_method='CASH' AND paid_at>=?").bind(shift.opened_at).first(),
  env.DB.prepare("SELECT COALESCE(SUM(amount),0) AS cash FROM pos_refunds WHERE method='CASH' AND created_at>=?").bind(shift.opened_at).first()]);
 return {shift:{...shift,expectedCash:shift.opening_cash+orders.cash+bills.cash-refunds.cash},cashSales:orders.cash+bills.cash,cashRefunds:refunds.cash};
}
export async function handleManagement(req,env,actor,deps){
 const path=new URL(req.url).pathname,method=req.method;
 if(!/^\/api\/staff\/(?:products|vouchers|schedules|attendance|cash-shifts|license)(?:\/|$)/.test(path))return null;
 try{
  if(path==='/api/staff/products'&&method==='GET'){
   if(!allowed(actor,'CATALOG_MANAGE'))return deny();
   const [products,recipes,ingredients]=await Promise.all([env.DB.prepare('SELECT * FROM pos_products ORDER BY id').all(),env.DB.prepare('SELECT product_id,ingredient_id,qty FROM pos_recipes ORDER BY product_id,ingredient_id').all(),env.DB.prepare('SELECT id,name,unit FROM pos_ingredients ORDER BY sku').all()]);
   return ok({products:products.results.map(rowProduct),recipes:recipes.results,ingredients:ingredients.results});
  }
  if(path==='/api/staff/products'&&method==='POST'){
   if(!allowed(actor,'CATALOG_MANAGE'))return deny();const b=await deps.body(req),p=parseProduct(b,true),recipe=b.recipe||[];
   check(Array.isArray(recipe)&&recipe.length<=30&&recipe.every(r=>r&&typeof r.ingredientId==='string'&&/^[A-Z0-9_-]{2,60}$/.test(r.ingredientId)&&integer(r.qty,100000)&&r.qty>0)&&new Set(recipe.map(r=>r.ingredientId)).size===recipe.length,'INVALID_PRODUCT');
   const time=new Date().toISOString(),statements=[env.DB.prepare('INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(p.id,p.sku,p.name,p.nameCn,p.category,p.station,p.price,p.largePrice,+p.active,p.icon,+p.size,+p.spicy,time),...recipe.map(r=>env.DB.prepare('INSERT INTO pos_recipes(product_id,ingredient_id,qty) VALUES(?,?,?)').bind(p.id,r.ingredientId,r.qty))];
   await env.DB.batch(statements);return ok({product:p},201);
  }
  const prod=path.match(/^\/api\/staff\/products\/([A-Za-z0-9_-]{1,24})$/);
  if(prod&&method==='PATCH'){
   if(!allowed(actor,'CATALOG_MANAGE'))return deny();const b=await deps.body(req),p=parseProduct(b,false);check(Number.isSafeInteger(b.version)&&b.version>=1,'INVALID_PRODUCT');
   const r=await env.DB.prepare('UPDATE pos_products SET sku=?,name=?,name_cn=?,category=?,station=?,price=?,large_price=?,active=?,icon=?,size=?,spicy=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(p.sku,p.name,p.nameCn,p.category,p.station,p.price,p.largePrice,+p.active,p.icon,+p.size,+p.spicy,new Date().toISOString(),prod[1],b.version).run();
   return r.meta.changes?ok({product:{...p,id:prod[1],version:b.version+1}}):bad(409,'PRODUCT_CHANGED','Món vừa được sửa ở máy khác, tải lại');
  }
  if(path==='/api/staff/vouchers'&&method==='GET'){
   if(!allowed(actor,'VOUCHER_MANAGE'))return deny();const {results=[]}=await env.DB.prepare('SELECT * FROM vouchers ORDER BY code').all();return ok({vouchers:results.map(voucherPublic)});
  }
  if(path==='/api/staff/vouchers'&&method==='POST'){
   if(!allowed(actor,'VOUCHER_MANAGE'))return deny();const v=parseVoucher(await deps.body(req)),id=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO vouchers(id,code,title_vi,title_zh,kind,value,min_spend,max_discount,member_only,active,listed,starts_at,ends_at,max_uses,per_member_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,v.code,v.titleVi,v.titleZh,v.kind,v.value,v.minSpend,v.maxDiscount,+v.memberOnly,+v.active,+v.listed,v.startsAt,v.endsAt,v.maxUses,v.perMemberLimit).run();return ok({id},201);
  }
  const voucher=path.match(/^\/api\/staff\/vouchers\/([a-zA-Z0-9-]{1,70})$/);
  if(voucher&&method==='PATCH'){
   if(!allowed(actor,'VOUCHER_MANAGE'))return deny();const v=parseVoucher(await deps.body(req));
   const r=await env.DB.prepare('UPDATE vouchers SET title_vi=?,title_zh=?,kind=?,value=?,min_spend=?,max_discount=?,member_only=?,active=?,listed=?,starts_at=?,ends_at=?,max_uses=?,per_member_limit=? WHERE id=? AND code=? COLLATE NOCASE AND (?>=reserved_count+redeemed_count OR ?=0)').bind(v.titleVi,v.titleZh,v.kind,v.value,v.minSpend,v.maxDiscount,+v.memberOnly,+v.active,+v.listed,v.startsAt,v.endsAt,v.maxUses,v.perMemberLimit,voucher[1],v.code,v.maxUses,v.maxUses).run();
   return r.meta.changes?ok({id:voucher[1]}):bad(409,'VOUCHER_CHANGED','Voucher đã đổi mã, đã dùng quá giới hạn mới hoặc không tồn tại');
  }
  if(path==='/api/staff/schedules'&&method==='GET'){
   const start=new URL(req.url).searchParams.get('from')||vietnamDay();check(day(start),'INVALID_SCHEDULE');
   const until=new Date(Date.parse(start+'T00:00:00Z')+14*86400000).toISOString().slice(0,10),visible=allowed(actor,'SHIFT_MANAGE')||allowed(actor,'ATTENDANCE_VIEW');
   const [r,staff]=await Promise.all([(visible?env.DB.prepare('SELECT * FROM pos_shift_schedules WHERE work_date>=? AND work_date<? ORDER BY work_date,start_time').bind(start,until):env.DB.prepare('SELECT * FROM pos_shift_schedules WHERE staff_id=? AND work_date>=? AND work_date<? ORDER BY work_date,start_time').bind(actor.id,start,until)).all(),allowed(actor,'SHIFT_MANAGE')?env.DB.prepare('SELECT id,display_name AS name FROM pos_staff_users WHERE active=1 ORDER BY display_name').all():Promise.resolve({results:[]})]);return ok({schedules:r.results,staff:allowed(actor,'SHIFT_MANAGE')?[{id:'OWNER',name:'Chủ cửa hàng'},...staff.results]:[]});
  }
  if(path==='/api/staff/schedules'&&method==='POST'){
   if(!allowed(actor,'SHIFT_MANAGE'))return deny();const b=await deps.body(req),staffId=txt(b.staffId,60),start=txt(b.startTime,5),end=txt(b.endTime,5),workDate=b.workDate,note=txt(b.note,160);
   check((staffId==='OWNER'||uuid(staffId))&&day(workDate)&&clock(start)&&clock(end)&&start<end,'INVALID_SCHEDULE');
   if(staffId!=='OWNER'){const staff=await env.DB.prepare('SELECT id FROM pos_staff_users WHERE id=? AND active=1').bind(staffId).first();check(staff,'INVALID_SCHEDULE')}
   const overlap=await env.DB.prepare('SELECT id FROM pos_shift_schedules WHERE staff_id=? AND work_date=? AND start_time<? AND end_time>?').bind(staffId,workDate,end,start).first();if(overlap)return bad(409,'SHIFT_OVERLAP','Nhân viên đã có ca trùng giờ');
   const id=crypto.randomUUID();await env.DB.prepare('INSERT INTO pos_shift_schedules(id,staff_id,work_date,start_time,end_time,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,staffId,workDate,start,end,note,actor.id,new Date().toISOString()).run();return ok({id},201);
  }
  const schedule=path.match(/^\/api\/staff\/schedules\/([a-f0-9-]{36})(?:\/remove)?$/i);
  if(schedule&&(method==='DELETE'||method==='POST'&&path.endsWith('/remove'))){
   if(!allowed(actor,'SHIFT_MANAGE'))return deny();const r=await env.DB.prepare('DELETE FROM pos_shift_schedules WHERE id=? AND work_date>=?').bind(schedule[1],vietnamDay()).run();return r.meta.changes?ok({}):bad(409,'SHIFT_NOT_FOUND','Chỉ được xóa ca chưa diễn ra');
  }
  if(path==='/api/staff/attendance'&&method==='GET'){
   const start=new URL(req.url).searchParams.get('from')||vietnamDay();check(day(start),'INVALID_ATTENDANCE');const until=new Date(Date.parse(start+'T00:00:00Z')+14*86400000).toISOString().slice(0,10);
   const q=allowed(actor,'ATTENDANCE_VIEW')?env.DB.prepare('SELECT * FROM pos_attendance WHERE work_date>=? AND work_date<? ORDER BY clock_in DESC LIMIT 200').bind(start,until):env.DB.prepare('SELECT * FROM pos_attendance WHERE staff_id=? AND work_date>=? AND work_date<? ORDER BY clock_in DESC LIMIT 50').bind(actor.id,start,until);
   return ok({attendance:(await q.all()).results});
  }
  if(path==='/api/staff/attendance/in'&&method==='POST'){
   const b=await deps.body(req),note=txt(b.note,160),id=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO pos_attendance(id,staff_id,work_date,clock_in,note) VALUES(?,?,?,?,?)').bind(id,actor.id,vietnamDay(),new Date().toISOString(),note).run();return ok({id},201);
  }
  if(path==='/api/staff/attendance/out'&&method==='POST'){
   const r=await env.DB.prepare("UPDATE pos_attendance SET clock_out=?,status='CLOSED' WHERE staff_id=? AND status='OPEN'").bind(new Date().toISOString(),actor.id).run();return r.meta.changes?ok({}):bad(409,'NO_OPEN_ATTENDANCE','Chưa chấm công vào');
  }
  if(path==='/api/staff/cash-shifts'&&method==='GET'){
   if(!allowed(actor,'SHIFT_MANAGE'))return deny();return ok(await cashOverview(env));
  }
  if(path==='/api/staff/cash-shifts/open'&&method==='POST'){
   if(!allowed(actor,'SHIFT_MANAGE'))return deny();const b=await deps.body(req);check(integer(b.openingCash),'INVALID_CASH_SHIFT');const id=crypto.randomUUID();
   await env.DB.prepare('INSERT INTO pos_cash_shifts(id,opened_by,opened_at,opening_cash) VALUES(?,?,?,?)').bind(id,actor.id,new Date().toISOString(),b.openingCash).run();return ok(await cashOverview(env),201);
  }
  if(path==='/api/staff/cash-shifts/close'&&method==='POST'){
   if(!allowed(actor,'SHIFT_MANAGE'))return deny();const b=await deps.body(req);check(uuid(b.id)&&integer(b.countedCash),'INVALID_CASH_SHIFT');
   const r=await env.DB.prepare(`UPDATE pos_cash_shifts SET status='CLOSED',closed_by=?,closed_at=?,counted_cash=?,note=?,expected_cash=opening_cash+
    (SELECT COALESCE(SUM(total),0) FROM qr_orders o WHERE status='PAID' AND payment_method='CASH' AND paid_at>=opened_at AND NOT EXISTS(SELECT 1 FROM pos_bills b WHERE b.order_id=o.id))-
    (SELECT COALESCE(SUM(amount),0) FROM pos_refunds WHERE method='CASH' AND created_at>=opened_at)+
    (SELECT COALESCE(SUM(total),0) FROM pos_bills WHERE payment_status='PAID' AND payment_method='CASH' AND paid_at>=opened_at)
    WHERE id=? AND status='OPEN'`).bind(actor.id,new Date().toISOString(),b.countedCash,txt(b.note,160),b.id).run();
   return r.meta.changes?ok({shift:await env.DB.prepare('SELECT * FROM pos_cash_shifts WHERE id=?').bind(b.id).first()}):bad(409,'SHIFT_CLOSED','Ca tiền đã đóng');
  }
  if(path==='/api/staff/license'&&method==='GET'){
   if(actor.role!=='OWNER')return deny();const r=await env.DB.prepare('SELECT last_four,expires_on,updated_at,updated_by FROM pos_license_poc WHERE id=1').first();
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   const daysRemaining=r?Math.round((Date.parse(r.expires_on+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null;
   return ok({license:r?{...r,status:daysRemaining>=0?'ACTIVE_POC':'EXPIRED_POC',daysRemaining}:null});
  }
  if(path==='/api/staff/license'&&method==='POST'){
   if(actor.role!=='OWNER')return deny();const b=await deps.body(req),key=txt(b.key,19).toUpperCase();
   check(/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){3}$/.test(key)&&day(b.expiresOn),'INVALID_LICENSE');
   const hash=await deps.sha('license-poc:'+env.SESSION_SECRET+':'+key);
   await env.DB.prepare('INSERT INTO pos_license_poc(id,key_hash,last_four,expires_on,updated_by,updated_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash,last_four=excluded.last_four,expires_on=excluded.expires_on,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(hash,key.slice(-4),b.expiresOn,actor.id,new Date().toISOString()).run();return ok({lastFour:key.slice(-4),expiresOn:b.expiresOn});
  }
  return bad(405,'METHOD_NOT_ALLOWED','Thao tác chưa hỗ trợ');
 }catch(e){
  const code=e?.message||'';
  if(['INVALID_PRODUCT','INVALID_VOUCHER_CONFIG','INVALID_SCHEDULE','INVALID_ATTENDANCE','INVALID_CASH_SHIFT','INVALID_LICENSE'].includes(code))return bad(400,code,'Dữ liệu nhập không hợp lệ');
  if(/STAFF_ON_LEAVE/i.test(code))return bad(409,'STAFF_ON_LEAVE','Nhân viên đã được duyệt nghỉ ngày này; chọn người khác hoặc đổi ngày');
  if(/UNIQUE|constraint|FOREIGN KEY|SHIFT_OVERLAP/i.test(code))return bad(409,'CONFLICT','Dữ liệu vừa thay đổi, đã tồn tại hoặc trùng ca');
  console.error('Counter management:',code);return bad(503,'SERVICE_UNAVAILABLE','Không ghi được D1; tải lại dữ liệu trước khi thử tiếp');
 }
}
