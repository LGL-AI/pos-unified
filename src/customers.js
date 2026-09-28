import {allowed} from './ops.js';
const tierFor=points=>points>=600?'Platinum':points>=300?'Gold':points>=100?'Silver':'Member';

const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const ok=(data,status=200)=>new Response(JSON.stringify({ok:true,...data}),{status,headers:H});
const fail=(status,code,message)=>new Response(JSON.stringify({ok:false,code,message}),{status,headers:H});
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const tidy=(x,max)=>typeof x==='string'?x.trim().slice(0,max+1):'';
const map=m=>({id:m.id,code:'KH'+String(m.seq).padStart(6,'0'),name:m.display_name,phone:m.phone,email:m.email,birthday:m.birthday,note:m.note,tier:m.tier_override||tierFor(m.points),tierOverride:m.tier_override,points:m.points,spend:m.spend,orders:m.orders,lastVisit:m.last_visit,phoneVerified:!!m.phone_verified,version:m.version});
const fields='rowid AS seq,id,phone,display_name,email,birthday,note,tier_override,points,spend,orders,last_visit,phone_verified,version';

export async function handleCustomers(req,env,actor,deps){
 const path=new URL(req.url).pathname,method=req.method;
 if(!/^\/api\/staff\/customers(?:\/[a-f0-9-]{36})?$/i.test(path))return null;
 if(method==='GET'&&path==='/api/staff/customers'){
  if(!allowed(actor,'ORDER_VIEW'))return fail(403,'PERMISSION_DENIED','Không có quyền xem khách hàng');
  const search=(new URL(req.url).searchParams.get('q')||'').trim().slice(0,80);
  const like='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
  const query=env.DB.prepare(`SELECT ${fields} FROM members WHERE (?='' OR phone LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 200`).bind(search,like,like,like);
  const [list,stats]=await Promise.all([query.all(),env.DB.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(spend),0) AS spend,COALESCE(SUM(CASE WHEN tier_override='Gold' OR (tier_override='' AND points>=300 AND points<600) THEN 1 ELSE 0 END),0) AS gold FROM members").first()]);
  const customers=list.results.map(map);
  return ok({customers,kpis:{total:stats.count,gold:stats.gold,totalSpend:stats.spend,averageSpend:stats.count?Math.round(stats.spend/stats.count):0},limited:customers.length===200});
 }
 if(method==='GET'){
  if(!allowed(actor,'ORDER_VIEW'))return fail(403,'PERMISSION_DENIED','Không có quyền xem khách hàng');
  const member=await env.DB.prepare(`SELECT ${fields} FROM members WHERE id=?`).bind(path.split('/').pop()).first();
  if(!member)return fail(404,'CUSTOMER_NOT_FOUND','Không thấy khách hàng');
  const orders=await env.DB.prepare('SELECT id,code,total,payment_status AS paymentStatus,created_at AS createdAt FROM qr_orders WHERE member_id=? ORDER BY created_at DESC LIMIT 30').bind(member.id).all();
  return ok({customer:map(member),recentOrders:orders.results});
 }
 if(method!=='POST'&&method!=='PATCH')return fail(405,'METHOD_NOT_ALLOWED','Chỉ hỗ trợ GET, POST, PATCH');
 if(method==='POST'&&path!=='/api/staff/customers'||method==='PATCH'&&path==='/api/staff/customers')return fail(405,'METHOD_NOT_ALLOWED','Đường dẫn không phù hợp');
 if(!allowed(actor,method==='POST'?'ORDER_EDIT':'CUSTOMER_MANAGE'))return fail(403,'PERMISSION_DENIED','Không có quyền sửa khách hàng');
 const b=await deps.body(req),name=tidy(b.name,80),phone=tidy(b.phone,11),email=tidy(b.email||'',120),birthday=tidy(b.birthday||'',10),note=tidy(b.note||'',500),tier=tidy(b.tierOverride||'',10);
 if(name.length<2||name.length>80||!/^0\d{9,10}$/.test(phone)||email.length>120||email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||birthday&&!/^\d{4}-\d{2}-\d{2}$/.test(birthday)||birthday&&(Number.isNaN(Date.parse(birthday+'T00:00:00Z'))||new Date(birthday+'T00:00:00Z').toISOString().slice(0,10)!==birthday)||note.length>500||!['','Member','Silver','Gold','Platinum'].includes(tier))return fail(400,'INVALID_CUSTOMER','Kiểm tra tên, số điện thoại, email, ngày sinh và hạng');
 try{
  if(method==='POST'){
   const newId=await deps.createCustomer(env,{name,phone,email,birthday,note,tier});
   const member=await env.DB.prepare(`SELECT ${fields} FROM members WHERE id=?`).bind(newId).first();return ok({customer:map(member)},201);
  }
  const customerId=path.split('/').pop();if(!uuid(customerId)||!Number.isSafeInteger(b.version)||b.version<1)return fail(400,'INVALID_CUSTOMER','Thiếu mã hoặc phiên bản khách hàng');
  const changed=await env.DB.prepare('UPDATE members SET display_name=?,phone=?,email=?,birthday=?,note=?,tier_override=?,version=version+1,updated_at=? WHERE id=? AND version=?').bind(name,phone,email,birthday,note,tier,new Date().toISOString(),customerId,b.version).run();
  if(!changed.meta.changes)return fail(409,'CUSTOMER_CHANGED','Khách hàng đã thay đổi, tải lại trước khi lưu');
  const member=await env.DB.prepare(`SELECT ${fields} FROM members WHERE id=?`).bind(customerId).first();return ok({customer:map(member)});
 }catch(e){if(/UNIQUE|constraint/i.test(e.message))return fail(409,'PHONE_EXISTS','Số điện thoại đã có khách hàng');throw e}
}
