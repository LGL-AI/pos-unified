// Public display endpoints return only till contents after a separate pairing token.
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const good=(data,status=200)=>new Response(JSON.stringify({ok:true,...data}),{status,headers});
const bad=(status,code)=>new Response(JSON.stringify({ok:false,code}),{status,headers});
const uuid=s=>typeof s==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const tok=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{40,100}$/.test(s);
const clean=(s,n=100)=>typeof s==='string'?s.trim().slice(0,n):'';
const storable=items=>items.map(x=>({name:x.name,nameCn:x.nameCn,qty:x.qty,price:x.price,mods:x.mods}));
const token=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function displayStaff(req,env,actor,deps){
 const path=new URL(req.url).pathname,method=req.method;
 if(!path.startsWith('/api/staff/display'))return null;
 if(!actor.permissions.includes('ORDER_EDIT'))return bad(403,'PERMISSION_DENIED');
 if(method==='POST'&&path==='/api/staff/display'){
  const id=crypto.randomUUID(),secret=token(),now=new Date().toISOString();
  await env.DB.prepare('INSERT INTO pos_display_sessions(id,owner_id,token_hash,expires_at,updated_at) VALUES(?,?,?,?,?)').bind(id,actor.id,await deps.sha(secret),Date.now()+12*3600000,now).run();
  return good({id,token:secret,expiresAt:Date.now()+12*3600000},201);
 }
 const match=path.match(/^\/api\/staff\/display\/([^/]+)$/);
 if(!match||!uuid(match[1]))return bad(404,'NOT_FOUND');
 if(method==='DELETE'){
  await env.DB.prepare('UPDATE pos_display_sessions SET revoked_at=? WHERE id=? AND owner_id=?').bind(new Date().toISOString(),match[1],actor.id).run();
  return good({});
 }
 if(method!=='PUT')return bad(405,'METHOD_NOT_ALLOWED');
 const d=await deps.body(req);
 if(!Number.isSafeInteger(d.revision)||d.revision<1||d.revision>2147483647)return bad(400,'INVALID_REVISION');
 let snapshot;
 if(d.orderId){
  if(!uuid(d.orderId))return bad(400,'INVALID_ORDER');
  const order=await env.DB.prepare('SELECT * FROM qr_orders WHERE id=?').bind(d.orderId).first();
  if(!order)return bad(404,'ORDER_NOT_FOUND');
  const o=deps.hydrate(order),[bills,refund]=await Promise.all([env.DB.prepare('SELECT sequence,total,payment_status FROM pos_bills WHERE order_id=? ORDER BY sequence').bind(d.orderId).all(),env.DB.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM pos_refunds WHERE order_id=?').bind(d.orderId).first()]);
  snapshot={stage:'PAYMENT',table:o.table,items:storable(o.items),subtotal:o.subtotal,discount:o.discount,total:o.total,taxAmount:o.taxAmount,taxMode:o.taxMode,refundedAmount:refund?.amount||0,code:o.code,paymentStatus:o.paymentStatus,paymentPreference:o.paymentPreference,status:o.status,bills:bills.results.map(b=>({number:b.sequence,total:b.total,paid:b.payment_status==='PAID'})),bankPayment:o.paymentStatus==='PAID'||o.status==='SPLIT'||o.paymentPreference==='CASH'?null:o.bankPayment};
 }else if(d.items){
  if(!Array.isArray(d.items)||d.items.length>30)return bad(400,'INVALID_CART');
  const table=clean(d.table,20).toUpperCase();
  if(d.items.length){const c=await deps.calculate({table,items:d.items},env);let discount=0;if(d.voucherCode){const member=d.memberId&&uuid(d.memberId)?await env.DB.prepare('SELECT id,display_name,phone_verified FROM members WHERE id=?').bind(d.memberId).first():null;try{const voucher=await deps.resolveVoucher(env,d.voucherCode,c.subtotal,member,new Date().toISOString());discount=voucher?.discount||0}catch{discount=0}}const totals=deps.priceTotals(c.subtotal,discount,await deps.getStore(env));snapshot={table,items:storable(c.items),...totals,code:null,paymentStatus:'DRAFT',status:'DRAFT',bills:[],bankPayment:null}}
  else snapshot={table:/^(T\d{2}|TAKEAWAY)$/.test(table)?table:'',items:[],subtotal:0,discount:0,total:0,code:null,paymentStatus:'DRAFT',status:'DRAFT',bills:[],bankPayment:null};
 }else return bad(400,'INVALID_SNAPSHOT');
 const store=await deps.getStore(env);snapshot.storeName=store.store_name;snapshot.storeNameCn=store.store_name_cn;
 const row=await env.DB.prepare('UPDATE pos_display_sessions SET snapshot_json=?,updated_at=?,revision=? WHERE id=? AND owner_id=? AND revoked_at IS NULL AND expires_at>? AND revision<?').bind(JSON.stringify(snapshot),new Date().toISOString(),d.revision,match[1],actor.id,Date.now(),d.revision).run();
 if(row.meta.changes)return good({snapshot});
 const current=await env.DB.prepare('SELECT revision FROM pos_display_sessions WHERE id=? AND owner_id=? AND revoked_at IS NULL AND expires_at>?').bind(match[1],actor.id,Date.now()).first();
 return current?good({stale:true}):bad(404,'PAIRING_EXPIRED');
}
export async function displayPublic(req,env,sha,equal){
 const id=new URL(req.url).pathname.match(/^\/api\/display\/([^/]+)$/)?.[1];
 if(req.method!=='GET')return bad(405,'METHOD_NOT_ALLOWED');
 if(!uuid(id))return bad(404,'NOT_FOUND');
 const secret=req.headers.get('X-Display-Token');if(!tok(secret))return bad(401,'DISPLAY_TOKEN_REQUIRED');
 const row=await env.DB.prepare('SELECT token_hash,snapshot_json,updated_at FROM pos_display_sessions WHERE id=? AND revoked_at IS NULL AND expires_at>?').bind(id,Date.now()).first();
 if(!row||!equal(row.token_hash,await sha(secret)))return bad(403,'PAIRING_EXPIRED');
 return good({snapshot:JSON.parse(row.snapshot_json),updatedAt:row.updated_at});
}
