// Cloud-owned staff identities, inventory and refund ledger. No browser role is trusted.
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const ok=(data,status=200)=>new Response(JSON.stringify({ok:true,...data}),{status,headers:H});
const bad=(status,code,message)=>new Response(JSON.stringify({ok:false,code,message}),{status,headers:H});
const VALID=['ORDER_VIEW','ORDER_EDIT','PAYMENT_CONFIRM','PRINT_KITCHEN','INVENTORY_VIEW','INVENTORY_MANAGE','REFUND_VIEW','REFUND_CREATE','STAFF_MANAGE','ROLE_MANAGE','SHIFT_MANAGE','ATTENDANCE_VIEW','CATALOG_MANAGE','VOUCHER_MANAGE'];
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
const clean=(v,n=100)=>typeof v==='string'?v.trim().slice(0,n):'';
const integer=n=>Number.isSafeInteger(n)&&n>0&&n<=100000000;
const now=()=>new Date().toISOString();
const te=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const from64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function derive(password,salt){const key=await crypto.subtle.importKey('raw',te.encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:from64(salt),iterations:120000,hash:'SHA-256'},key,256))}
const permissions=role=>Array.isArray(role)?role:JSON.parse(role||'[]');
const owner=()=>({id:'OWNER',username:'huang',name:'Chủ cửa hàng',role:'OWNER',permissions:VALID});
export const allowed=(actor,permission)=>Boolean(actor?.permissions.includes(permission));
export async function sessionActor(env,token,sha){
 const s=await env.DB.prepare('SELECT staff_id FROM pos_staff_sessions WHERE token_hash=? AND expires_at>?').bind(await sha(token),Date.now()).first();
 if(!s)return null;
 if(!s.staff_id)return owner();
 const row=await env.DB.prepare('SELECT u.id,u.username,u.display_name,u.active,u.role_id,r.permissions_json,r.active AS role_active FROM pos_staff_users u JOIN pos_roles r ON r.id=u.role_id WHERE u.id=?').bind(s.staff_id).first();
 return row?.active&&row.role_active?{id:row.id,username:row.username,name:row.display_name,role:row.role_id,permissions:permissions(row.permissions_json)}:null;
}
export async function loginActor(env,username,password,deps){
 const name=clean(username||'huang',40).toLowerCase();
 if(name==='huang'){
  if(typeof env.POS_STAFF_PASSWORD!=='string'||env.POS_STAFF_PASSWORD.length<6)return null;
  return deps.equal(await deps.sha(password),await deps.sha(env.POS_STAFF_PASSWORD))?{actor:owner(),staffId:null}:null;
 }
 if(!/^[a-z0-9._-]{3,40}$/.test(name))return null;
 const row=await env.DB.prepare('SELECT u.*,r.permissions_json,r.active AS role_active FROM pos_staff_users u JOIN pos_roles r ON r.id=u.role_id WHERE u.username=? COLLATE NOCASE').bind(name).first();
 if(!row?.active||!row.role_active)return null;
 const hash=await derive(password,row.password_salt);
 if(!deps.equal(hash,row.password_hash))return null;
 return {staffId:row.id,actor:{id:row.id,username:row.username,name:row.display_name,role:row.role_id,permissions:permissions(row.permissions_json)}};
}

export async function catalogInventory(env,base){
 const estimateMode=!!(await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='pos_inventory_estimates'").first());
 const modifierMode=!!(await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='pos_product_modifiers'").first());
 const modifierRows=modifierMode?(await env.DB.prepare('SELECT m.product_id,m.group_code,m.min_select,m.max_select,o.option_code,o.option_vi,o.option_zh,o.price_delta FROM pos_product_modifiers m JOIN pos_menu_options o ON o.group_code=m.group_code ORDER BY m.product_id,m.group_code,o.option_code').all()).results:[];
 const modifierByProduct=new Map();
 for(const row of modifierRows){let groups=modifierByProduct.get(row.product_id);if(!groups){groups=[];modifierByProduct.set(row.product_id,groups)}let group=groups.find(x=>x.code===row.group_code);if(!group){group={code:row.group_code,min:row.min_select,max:row.max_select,options:[]};groups.push(group)}group.options.push({code:row.option_code,name:row.option_vi,nameCn:row.option_zh,priceDelta:row.price_delta})}
 const {results:products=[]}=await env.DB.prepare('SELECT * FROM pos_products ORDER BY id').all();
 const {results=[]}=await env.DB.prepare(`SELECT p.product_id,p.stock,p.min_stock,
  COALESCE(MIN(CASE WHEN r.ingredient_id IS NULL THEN 1 WHEN i.stock>=r.qty THEN 1 ELSE 0 END),1) AS ingredients_ok
  FROM pos_product_inventory p LEFT JOIN pos_recipes r ON r.product_id=p.product_id
  LEFT JOIN pos_ingredients i ON i.id=r.ingredient_id GROUP BY p.product_id`).all();
 const byId=new Map(results.map(x=>[x.product_id,x]));
 return {...base,products:products.map(row=>{const q=byId.get(row.id);return {id:row.id,sku:row.sku,name:row.name,nameCn:row.name_cn,category:row.category,categoryCn:row.category_zh||'',sizeLabel:row.size_label||'ONE',itemNote:row.item_note||'',sourceImage:row.source_image||'',bestSeller:!!row.best_seller,modifiers:modifierByProduct.get(row.id)||[],station:row.station,price:row.price,largePrice:row.large_price,active:!!row.active,icon:row.icon,size:!!row.size,spicy:!!row.spicy,version:row.version,available:!!(row.active&&(estimateMode||q?.stock>0&&q.ingredients_ok)),stock:q?.stock??0,lowStock:!!q&&q.stock<=q.min_stock}})};
}

function permissionList(value){if(!Array.isArray(value)||value.length>VALID.length||value.some(x=>!VALID.includes(x))||new Set(value).size!==value.length)throw Error('INVALID_PERMISSIONS');return value}
const deny=()=>bad(403,'PERMISSION_DENIED','Tài khoản không có quyền thực hiện thao tác này');
const errors={INVALID_PERMISSIONS:'Danh sách quyền không hợp lệ',INVALID_ROLE:'Vai trò không hợp lệ',INVALID_STAFF:'Thông tin nhân viên không hợp lệ',INVALID_STOCK:'Số lượng hoặc loại kho không hợp lệ',INVALID_PLAN:'Lịch nhập hàng không hợp lệ',INVALID_REFUND:'Thông tin hoàn tiền không hợp lệ',REQUEST_ID_REUSED:'Mã yêu cầu đã dùng cho thay đổi khác',OUT_OF_STOCK:'Sản phẩm hết hàng',INGREDIENT_OUT_OF_STOCK:'Nguyên liệu không đủ',STOCK_CANNOT_BE_NEGATIVE:'Không thể trừ tồn kho xuống âm',PLAN_CHANGED:'Lịch nhập đã xử lý hoặc số lượng đã đổi',REFUND_EXCEEDS_PAID:'Số tiền hoàn vượt tiền đã thu',REFUND_EXCEEDS_BILL:'Số tiền hoàn vượt bill đã thu',REFUND_BILL_REQUIRED:'Đơn tách bill phải chọn bill đã thanh toán',REFUND_BILL_INVALID:'Bill không thuộc đơn',ORDER_NOT_PAID:'Chỉ hoàn đơn đã thanh toán',REFUND_STOCK_EXCEEDS_SOLD:'Số phần nhập lại vượt số phần đã bán',INVALID_ADJUSTMENT:'Loại điều chỉnh kho không hợp lệ'};
function opError(e){const code=e?.message||'';if(errors[code])return bad(['INVALID_PERMISSIONS','INVALID_ROLE','INVALID_STAFF','INVALID_STOCK','INVALID_PLAN','INVALID_REFUND'].includes(code)?400:409,code,errors[code]);if(/UNIQUE|constraint|FOREIGN KEY/i.test(code))return bad(409,'CONFLICT','Dữ liệu vừa được thay đổi hoặc đã tồn tại');console.error('POS operations:',code);return bad(503,'SERVICE_UNAVAILABLE','Máy chủ tạm gián đoạn; kiểm tra dữ liệu trước khi thử lại')}
async function inventory(env){
 const migrated=await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='pos_inventory_estimates'").first();
 const [products,ingredients,recipes,movements,plans,estimates]=await Promise.all([
  env.DB.prepare('SELECT * FROM pos_product_inventory ORDER BY product_id').all(),
  env.DB.prepare('SELECT * FROM pos_ingredients ORDER BY sku').all(),
  env.DB.prepare('SELECT * FROM pos_recipes ORDER BY product_id,ingredient_id').all(),
  env.DB.prepare('SELECT * FROM pos_inventory_movements ORDER BY created_at DESC LIMIT 60').all(),
  env.DB.prepare('SELECT * FROM pos_restock_plans ORDER BY due_date ASC LIMIT 60').all(),
  migrated?env.DB.prepare("SELECT target,ref_id,estimated_stock FROM pos_inventory_estimates ORDER BY target,ref_id").all():Promise.resolve({results:[]})]);
 return ok({products:products.results,ingredients:ingredients.results,recipes:recipes.results,movements:movements.results,plans:plans.results,estimates:estimates.results});
}
function staffPublic(u){return{id:u.id,username:u.username,name:u.display_name,role:u.role_id,active:!!u.active}}
export async function handleOps(req,env,actor,deps){
 const path=new URL(req.url).pathname,method=req.method;
 if(!/^\/api\/staff\/(?:inventory|refunds|roles|accounts)(?:\/|$)/.test(path))return null;
 try{
  if(path==='/api/staff/inventory'&&method==='GET')return allowed(actor,'INVENTORY_VIEW')?inventory(env):deny();
  if(path==='/api/staff/inventory/adjust'&&method==='POST'){
   if(!allowed(actor,'INVENTORY_MANAGE'))return deny();const b=await deps.body(req);
   if(!['PRODUCT','INGREDIENT'].includes(b.target)||!['RECEIPT','ADJUST_PLUS','ADJUST_MINUS'].includes(b.kind)||!integer(b.quantity)||!clean(b.reference,150)||typeof b.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(b.idempotencyKey))throw Error('INVALID_STOCK');
   const delta=b.kind==='ADJUST_MINUS'?-b.quantity:b.quantity;
   const id=clean(b.id,60);if(!id)throw Error('INVALID_STOCK');
   const fingerprint=await deps.sha(JSON.stringify({target:b.target,id,delta,kind:b.kind,reference:clean(b.reference,150)}));
   const prior=await env.DB.prepare('SELECT fingerprint FROM pos_inventory_adjustments WHERE idem_key=?').bind(b.idempotencyKey).first();
   if(prior){if(prior.fingerprint!==fingerprint)return bad(409,'REQUEST_ID_REUSED',errors.REQUEST_ID_REUSED);return inventory(env)}
   await env.DB.prepare('INSERT INTO pos_inventory_adjustments(id,product_id,ingredient_id,delta,kind,reference,actor_id,idem_key,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idem_key) DO NOTHING')
    .bind(crypto.randomUUID(),b.target==='PRODUCT'?id:null,b.target==='INGREDIENT'?id:null,delta,b.kind,clean(b.reference,150),actor.id,b.idempotencyKey,fingerprint,now()).run();
   const saved=await env.DB.prepare('SELECT fingerprint FROM pos_inventory_adjustments WHERE idem_key=?').bind(b.idempotencyKey).first();
   if(saved?.fingerprint!==fingerprint)return bad(409,'REQUEST_ID_REUSED',errors.REQUEST_ID_REUSED);
   return inventory(env);
  }
  if(path==='/api/staff/inventory/plans'&&method==='POST'){
   if(!allowed(actor,'INVENTORY_MANAGE'))return deny();const b=await deps.body(req),id=clean(b.ingredientId,60),supplier=clean(b.supplier,100);
   if(!integer(b.quantity)||!id||!supplier||typeof b.dueDate!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.dueDate)||Number.isNaN(Date.parse(b.dueDate)))throw Error('INVALID_PLAN');
   await env.DB.prepare('INSERT INTO pos_restock_plans(id,ingredient_id,qty,due_date,supplier,actor_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,b.quantity,b.dueDate,supplier,actor.id,now()).run();return inventory(env);
  }
  const receive=path.match(/^\/api\/staff\/inventory\/plans\/([0-9a-f-]{36})\/receive$/i);
  if(receive&&method==='POST'){
   if(!allowed(actor,'INVENTORY_MANAGE'))return deny();if(!uuid(receive[1]))throw Error('INVALID_PLAN');
   const plan=await env.DB.prepare('SELECT * FROM pos_restock_plans WHERE id=?').bind(receive[1]).first();if(!plan||plan.status!=='PLANNED')return bad(409,'PLAN_CHANGED',errors.PLAN_CHANGED);
   await env.DB.prepare('INSERT INTO pos_inventory_adjustments(id,ingredient_id,delta,kind,reference,actor_id,plan_id,idem_key,fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),plan.ingredient_id,plan.qty,'RECEIPT',plan.supplier,actor.id,plan.id,'receive:'+plan.id,plan.id,now()).run();return inventory(env);
  }
  if(path==='/api/staff/refunds'&&method==='GET'){
   if(!allowed(actor,'REFUND_VIEW'))return deny();const id=new URL(req.url).searchParams.get('orderId');if(!uuid(id))throw Error('INVALID_REFUND');
   const {results=[]}=await env.DB.prepare('SELECT * FROM pos_refunds WHERE order_id=? ORDER BY created_at DESC').bind(id).all();
   const {results:items=[]}=await env.DB.prepare('SELECT x.* FROM pos_refund_items x JOIN pos_refunds r ON r.id=x.refund_id WHERE r.order_id=?').bind(id).all();
   const {results:lines=[]}=await env.DB.prepare('SELECT l.* FROM pos_refund_line_items l JOIN pos_refunds r ON r.id=l.refund_id WHERE r.order_id=?').bind(id).all();
   return ok({refunds:results.map(r=>({...r,restockItems:items.filter(x=>x.refund_id===r.id).map(x=>({productId:x.product_id,quantity:x.qty})),lineItems:lines.filter(x=>x.refund_id===r.id).map(x=>({productId:x.product_id,name:x.product_name,quantity:x.qty,amount:x.amount,category:x.category}))}))});
  }
  if(path==='/api/staff/refunds'&&method==='POST'){
   if(!allowed(actor,'REFUND_CREATE'))return deny();const b=await deps.body(req),orderId=b.orderId,billId=b.billId||null,
    reason=clean(b.reason,200),idem=b.idempotencyKey,method=b.method,restock=Array.isArray(b.restockItems)?b.restockItems:[];
   if(!uuid(orderId)||(billId!==null&&!/^[0-9a-f-]{36}:[1-9][0-9]*$/i.test(billId))||!integer(b.amount)||!reason||!['CASH','BANK'].includes(method)||typeof idem!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(idem)||restock.length>13)throw Error('INVALID_REFUND');
   if(restock.length&&(!allowed(actor,'INVENTORY_MANAGE')||b.confirmRestock!==true))return deny();
   if(restock.some(x=>!x||!integer(x.quantity)||!/^[A-Za-z0-9_-]{1,24}$/.test(String(x.productId)))||new Set(restock.map(x=>String(x.productId))).size!==restock.length)throw Error('INVALID_REFUND');
   const normalized=restock.map(x=>({productId:String(x.productId),quantity:x.quantity})).sort((a,b)=>a.productId.localeCompare(b.productId));
   const row=billId?await env.DB.prepare('SELECT items_json FROM pos_bills WHERE id=? AND order_id=?').bind(billId,orderId).first():await env.DB.prepare('SELECT items_json FROM qr_orders WHERE id=?').bind(orderId).first();
   const sold=new Map();for(const x of row?JSON.parse(row.items_json):[]){const key=String(x.productId),previous=sold.get(key);sold.set(key,{name:x.name,qty:(previous?.qty||0)+x.qty})}
   const lineItems=Array.isArray(b.lineItems)?b.lineItems:[];
   if(lineItems.length>20||lineItems.some(x=>!x||!['RETURNED','COMPENSATED'].includes(x.category)||!integer(x.quantity)||!Number.isSafeInteger(x.amount)||x.amount<0||!sold.has(String(x.productId)))||new Set(lineItems.map(x=>x.productId+':'+x.category)).size!==lineItems.length||lineItems.reduce((n,x)=>n+x.amount,0)>b.amount)throw Error('INVALID_REFUND');
   const lines=lineItems.map(x=>({productId:String(x.productId),name:sold.get(String(x.productId)).name,quantity:x.quantity,amount:x.amount,category:x.category})).sort((a,b)=>(a.productId+a.category).localeCompare(b.productId+b.category));
   const fingerprint=await deps.sha(JSON.stringify({orderId,billId,amount:b.amount,reason,method,restock:normalized,lines}));
   const prior=await env.DB.prepare('SELECT * FROM pos_refunds WHERE idem_key=?').bind(idem).first();
   if(prior)return prior.fingerprint===fingerprint?ok({refund:prior,duplicate:true}):bad(409,'REQUEST_ID_REUSED','Mã giao dịch đã dùng cho khoản hoàn khác');
   for(const line of lines){const used=await env.DB.prepare('SELECT COALESCE(SUM(l.qty),0) AS qty FROM pos_refund_line_items l JOIN pos_refunds r ON r.id=l.refund_id WHERE r.order_id=? AND COALESCE(r.bill_id,\'\')=COALESCE(?,\'\') AND l.product_id=?').bind(orderId,billId,line.productId).first();if(used.qty+lines.filter(x=>x.productId===line.productId).reduce((n,x)=>n+x.quantity,0)>sold.get(line.productId).qty)throw Error('INVALID_REFUND')}
   const id=crypto.randomUUID(),time=now();
   const statements=[env.DB.prepare('INSERT INTO pos_refunds(id,idem_key,fingerprint,order_id,bill_id,amount,reason,method,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(idem_key) DO NOTHING')
    .bind(id,idem,fingerprint,orderId,billId,b.amount,reason,method,actor.id,time),...normalized.map(x=>env.DB.prepare('INSERT INTO pos_refund_items(refund_id,product_id,qty) VALUES(?,?,?)').bind(id,x.productId,x.quantity)),...lines.map(x=>env.DB.prepare('INSERT INTO pos_refund_line_items(refund_id,product_id,product_name,qty,amount,category) VALUES(?,?,?,?,?,?)').bind(id,x.productId,x.name,x.quantity,x.amount,x.category))];
   await env.DB.batch(statements);
   const saved=await env.DB.prepare('SELECT * FROM pos_refunds WHERE idem_key=?').bind(idem).first();
   if(!saved)return bad(503,'REFUND_NOT_SAVED','Chưa ghi được khoản hoàn');
   return saved.fingerprint===fingerprint?ok({refund:saved,duplicate:saved.id!==id},saved.id===id?201:200):bad(409,'REQUEST_ID_REUSED','Mã giao dịch đã dùng cho khoản hoàn khác');
  }
  if(path==='/api/staff/roles'&&method==='GET'){
   if(!allowed(actor,'STAFF_MANAGE'))return deny();const {results=[]}=await env.DB.prepare('SELECT * FROM pos_roles ORDER BY system DESC,id').all();
   return ok({availablePermissions:VALID,roles:results.map(r=>({id:r.id,name:r.name,permissions:permissions(r.permissions_json),active:!!r.active,system:!!r.system}))});
  }
  if(path==='/api/staff/roles'&&method==='POST'){
   if(!allowed(actor,'ROLE_MANAGE'))return deny();const b=await deps.body(req),id=clean(b.id,32).toUpperCase(),name=clean(b.name,80);
   if(!/^[A-Z][A-Z0-9_]{2,31}$/.test(id)||!name||['OWNER','MANAGER','CASHIER','KITCHEN'].includes(id))throw Error('INVALID_ROLE');
   await env.DB.prepare('INSERT INTO pos_roles(id,name,permissions_json) VALUES(?,?,?)').bind(id,name,JSON.stringify(permissionList(b.permissions))).run();return ok({id},201);
  }
  const rolePath=path.match(/^\/api\/staff\/roles\/([A-Z][A-Z0-9_]{2,31})$/);
  if(rolePath&&(method==='PATCH'||method==='POST')){
   if(!allowed(actor,'ROLE_MANAGE'))return deny();const id=rolePath[1];if(id==='OWNER')return bad(403,'OWNER_PROTECTED','Không thể thay đổi vai trò chủ cửa hàng');
   const b=await deps.body(req),name=clean(b.name,80);if(!name||typeof b.active!=='boolean')throw Error('INVALID_ROLE');
   const r=await env.DB.prepare('UPDATE pos_roles SET name=?,permissions_json=?,active=? WHERE id=?').bind(name,JSON.stringify(permissionList(b.permissions)),b.active?1:0,id).run();return r.meta.changes?ok({id}):bad(404,'ROLE_NOT_FOUND','Không thấy vai trò');
  }
  if(path==='/api/staff/accounts'&&method==='GET'){
   if(!allowed(actor,'STAFF_MANAGE'))return deny();const {results=[]}=await env.DB.prepare('SELECT id,username,display_name,role_id,active FROM pos_staff_users ORDER BY username').all();
   return ok({accounts:results.map(staffPublic)});
  }
  if(path==='/api/staff/accounts'&&method==='POST'){
   if(!allowed(actor,'STAFF_MANAGE'))return deny();const b=await deps.body(req),username=clean(b.username,40).toLowerCase(),name=clean(b.name,80),pass=b.password,role=clean(b.role,32).toUpperCase();
   if(!/^[a-z0-9._-]{3,40}$/.test(username)||username==='huang'||!name||typeof pass!=='string'||pass.length<10||pass.length>128||role==='OWNER')throw Error('INVALID_STAFF');
   const found=await env.DB.prepare('SELECT id FROM pos_roles WHERE id=? AND active=1').bind(role).first();if(!found)throw Error('INVALID_ROLE');
   const salt=b64(crypto.getRandomValues(new Uint8Array(16))),hash=await derive(pass,salt),id=crypto.randomUUID(),time=now();
   await env.DB.prepare('INSERT INTO pos_staff_users(id,username,display_name,role_id,password_salt,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(id,username,name,role,salt,hash,time,time).run();return ok({account:{id,username,name,role,active:true}},201);
  }
  const accountPath=path.match(/^\/api\/staff\/accounts\/([a-f0-9-]{36})$/i);
  if(accountPath&&(method==='PATCH'||method==='POST')){
   if(!allowed(actor,'STAFF_MANAGE'))return deny();if(!uuid(accountPath[1]))throw Error('INVALID_STAFF');const b=await deps.body(req),name=clean(b.name,80),role=clean(b.role,32).toUpperCase();
   if(!name||role==='OWNER'||typeof b.active!=='boolean'||(b.password!==undefined&&(typeof b.password!=='string'||b.password.length<10||b.password.length>128)))throw Error('INVALID_STAFF');
   const found=await env.DB.prepare('SELECT id FROM pos_roles WHERE id=? AND active=1').bind(role).first();if(!found)throw Error('INVALID_ROLE');
   const salt=b.password?b64(crypto.getRandomValues(new Uint8Array(16))):null,hash=b.password?await derive(b.password,salt):null;
   const r=await env.DB.prepare('UPDATE pos_staff_users SET display_name=?,role_id=?,active=?,password_salt=COALESCE(?,password_salt),password_hash=COALESCE(?,password_hash),updated_at=? WHERE id=?')
    .bind(name,role,b.active?1:0,salt,hash,now(),accountPath[1]).run();
   if(r.meta.changes)await env.DB.prepare('DELETE FROM pos_staff_sessions WHERE staff_id=?').bind(accountPath[1]).run();
   return r.meta.changes?ok({id:accountPath[1]}):bad(404,'STAFF_NOT_FOUND','Không thấy nhân viên');
  }
  return bad(404,'NOT_FOUND','Đường dẫn không tồn tại');
 }catch(e){return opError(e)}
}
