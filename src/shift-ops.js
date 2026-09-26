import {allowed} from './ops.js';

const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const ok=(v,status=200)=>new Response(JSON.stringify({ok:true,...v}),{status,headers:H});
const bad=(status,code,message)=>new Response(JSON.stringify({ok:false,code,message}),{status,headers:H});
const txt=(v,n)=>typeof v==='string'?v.trim().slice(0,n):'';
const day=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const clock=v=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v||'');
const uuid=v=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v||'');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const iso=()=>new Date().toISOString();
const manage=a=>allowed(a,'SHIFT_MANAGE');
const canSee=a=>manage(a)||allowed(a,'ATTENDANCE_VIEW');
const staffId=v=>v==='OWNER'||uuid(v);
const requireInput=(condition,code='INVALID_SHIFT_DATA')=>{if(!condition)throw Error(code)};
const tables={delivery:'pos_supplier_deliveries',leave:'pos_leave_requests',task:'pos_shift_tasks',ot:'pos_ot_requests',swap:'pos_swap_requests',handover:'pos_shift_handovers',correction:'pos_attendance_corrections'};
async function realStaff(env,ref){if(ref==='OWNER')return true;return !!(staffId(ref)&&await env.DB.prepare('SELECT id FROM pos_staff_users WHERE id=? AND active=1').bind(ref).first())}
async function insertOnce(env,deps,kind,b,actor,fields,values){
 const requestKey=txt(b.requestKey,70);requireInput(uuid(requestKey));
 const hash=await deps.sha(JSON.stringify({kind,body:b,actor:actor.id}));
 const table=tables[kind],prior=await env.DB.prepare(`SELECT id,request_hash FROM ${table} WHERE request_key=?`).bind(requestKey).first();
 if(prior)return prior.request_hash===hash?ok({id:prior.id,duplicate:true}):bad(409,'REQUEST_KEY_REUSED','Mã yêu cầu đã dùng cho dữ liệu khác');
 const id=crypto.randomUUID();
 await env.DB.prepare(`INSERT INTO ${table}(id,request_key,request_hash,${fields.join(',')}) VALUES(${Array(fields.length+3).fill('?').join(',')}) ON CONFLICT(request_key) DO NOTHING`).bind(id,requestKey,hash,...values).run();
 const saved=await env.DB.prepare(`SELECT id,request_hash FROM ${table} WHERE request_key=?`).bind(requestKey).first();
 return saved?.request_hash===hash?ok({id:saved.id,duplicate:saved.id!==id},saved.id===id?201:200):bad(409,'REQUEST_KEY_REUSED','Mã yêu cầu đã dùng cho dữ liệu khác');
}
async function list(env,actor,from,to){
 const staff=actor.id,see=canSee(actor);
 const queries={
  deliveries:see?env.DB.prepare('SELECT * FROM pos_supplier_deliveries WHERE due_date BETWEEN ? AND ? ORDER BY due_date,due_time LIMIT 200').bind(from,to):env.DB.prepare('SELECT * FROM pos_supplier_deliveries WHERE receiver_id=? AND due_date BETWEEN ? AND ? ORDER BY due_date,due_time LIMIT 100').bind(staff,from,to),
  leave:see?env.DB.prepare('SELECT * FROM pos_leave_requests WHERE from_date<=? AND to_date>=? ORDER BY created_at DESC LIMIT 200').bind(to,from):env.DB.prepare('SELECT * FROM pos_leave_requests WHERE staff_id=? AND from_date<=? AND to_date>=? ORDER BY created_at DESC LIMIT 100').bind(staff,to,from),
  tasks:see?env.DB.prepare('SELECT * FROM pos_shift_tasks WHERE work_date BETWEEN ? AND ? ORDER BY work_date,due_time LIMIT 200').bind(from,to):env.DB.prepare('SELECT * FROM pos_shift_tasks WHERE assignee_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date,due_time LIMIT 100').bind(staff,from,to),
  ot:see?env.DB.prepare('SELECT * FROM pos_ot_requests WHERE work_date BETWEEN ? AND ? ORDER BY work_date DESC LIMIT 200').bind(from,to):env.DB.prepare('SELECT * FROM pos_ot_requests WHERE staff_id=? AND work_date BETWEEN ? AND ? ORDER BY work_date DESC LIMIT 100').bind(staff,from,to),
  swaps:see?env.DB.prepare('SELECT x.*,s.work_date,s.start_time,s.end_time FROM pos_swap_requests x LEFT JOIN pos_shift_schedules s ON s.id=x.schedule_id WHERE (s.work_date BETWEEN ? AND ? OR s.id IS NULL) ORDER BY x.created_at DESC LIMIT 200').bind(from,to):env.DB.prepare('SELECT x.*,s.work_date,s.start_time,s.end_time FROM pos_swap_requests x LEFT JOIN pos_shift_schedules s ON s.id=x.schedule_id WHERE (x.from_staff_id=? OR x.to_staff_id=?) AND (s.work_date BETWEEN ? AND ? OR s.id IS NULL) ORDER BY x.created_at DESC LIMIT 100').bind(staff,staff,from,to),
  handovers:see?env.DB.prepare("SELECT * FROM pos_shift_handovers WHERE date(created_at,'+7 hours') BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 200").bind(from,to):env.DB.prepare("SELECT * FROM pos_shift_handovers WHERE (from_staff_id=? OR to_staff_id=?) AND date(created_at,'+7 hours') BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 100").bind(staff,staff,from,to),
  corrections:see?env.DB.prepare("SELECT * FROM pos_attendance_corrections WHERE date(created_at,'+7 hours') BETWEEN ? AND ? ORDER BY created_at DESC LIMIT 150").bind(from,to):null,
  cash:see?env.DB.prepare("SELECT * FROM pos_cash_shifts WHERE date(opened_at,'+7 hours') BETWEEN ? AND ? ORDER BY opened_at DESC LIMIT 120").bind(from,to):null
 };
 const entries=await Promise.all(Object.entries(queries).map(async([key,q])=>[key,q?(await q.all()).results:[]]));
 return ok({from,to,...Object.fromEntries(entries)});
}
export async function handleShiftOps(req,env,actor,deps){
 const path=new URL(req.url).pathname,method=req.method;
 if(!path.startsWith('/api/staff/shift-ops'))return null;
 try{
  if(path==='/api/staff/shift-ops'&&method==='GET'){
   const params=new URL(req.url).searchParams,from=params.get('from')||today(),to=params.get('to')||from;
   requireInput(day(from)&&day(to)&&from<=to&&(Date.parse(to)-Date.parse(from))/86400000<=31);
   return list(env,actor,from,to);
  }
  const create=path.match(/^\/api\/staff\/shift-ops\/(delivery|leave|task|ot|swap|handover|correction)$/);
  if(create&&method==='POST'){
   const kind=create[1],b=await deps.body(req),time=iso(),who=actor.id;
   if(kind==='delivery'){
    if(!manage(actor))return bad(403,'PERMISSION_DENIED','Chỉ quản lý được lập lịch nhập hàng');
    const supplier=txt(b.supplier,100),po=txt(b.poNumber,60),receiver=txt(b.receiverId,60),items=txt(b.items,600),phone=txt(b.supplierPhone,30),note=txt(b.note,200),shift=txt(b.shiftName,30);
    requireInput(supplier&&day(b.dueDate)&&clock(b.dueTime)&&['MORNING','AFTERNOON','EVENING'].includes(shift)&&items&&await realStaff(env,receiver));
    return insertOnce(env,deps,kind,b,actor,['supplier','po_number','due_date','due_time','shift_name','receiver_id','items_text','supplier_phone','note','created_by','created_at'],[supplier,po,b.dueDate,b.dueTime,shift,receiver,items,phone,note,who,time]);
   }
   if(kind==='leave'){
    const person=manage(actor)?txt(b.staffId,60):who,leaveType=txt(b.leaveType,40),reason=txt(b.reason,500);
    requireInput(await realStaff(env,person)&&day(b.fromDate)&&day(b.toDate)&&b.fromDate<=b.toDate&&(Date.parse(b.toDate)-Date.parse(b.fromDate))/86400000<=30&&['ANNUAL','SICK','PERSONAL'].includes(leaveType)&&reason);
    return insertOnce(env,deps,kind,b,actor,['staff_id','from_date','to_date','leave_type','reason','created_at'],[person,b.fromDate,b.toDate,leaveType,reason,time]);
   }
   if(kind==='task'){
    if(!manage(actor))return bad(403,'PERMISSION_DENIED','Chỉ quản lý được phân công task');
    const name=txt(b.titleVi,160),nameZh=txt(b.titleZh,160),assigned=txt(b.assigneeId,60),phase=b.phase,priority=b.priority;
    requireInput(day(b.workDate)&&name&&nameZh&&['OPEN','CLEAN','MID','CLOSE'].includes(phase)&&['LOW','NORMAL','HIGH'].includes(priority)&&clock(b.dueTime)&&await realStaff(env,assigned));
    return insertOnce(env,deps,kind,b,actor,['work_date','title_vi','title_zh','phase','assignee_id','due_time','priority','created_by','created_at'],[b.workDate,name,nameZh,phase,assigned,b.dueTime,priority,who,time]);
   }
   if(kind==='ot'){
    const person=manage(actor)?txt(b.staffId,60):who,reason=txt(b.reason,300);
    requireInput(await realStaff(env,person)&&day(b.workDate)&&clock(b.startTime)&&clock(b.endTime)&&b.startTime<b.endTime&&reason);
    return insertOnce(env,deps,kind,b,actor,['staff_id','work_date','start_time','end_time','reason','created_at'],[person,b.workDate,b.startTime,b.endTime,reason,time]);
   }
   if(kind==='swap'){
    const schedule=await env.DB.prepare('SELECT * FROM pos_shift_schedules WHERE id=?').bind(b.scheduleId).first(),other=txt(b.toStaffId,60),reason=txt(b.reason,300);
    requireInput(schedule&&schedule.work_date>=today()&&(manage(actor)||schedule.staff_id===who)&&other!==schedule.staff_id&&await realStaff(env,other)&&reason,'INVALID_SWAP');
    return insertOnce(env,deps,kind,b,actor,['schedule_id','from_staff_id','to_staff_id','reason','created_at'],[schedule.id,schedule.staff_id,other,reason,time]);
   }
   if(kind==='handover'){
    if(!manage(actor))return bad(403,'PERMISSION_DENIED','Chỉ quản lý được tạo bàn giao');
    const recipient=txt(b.toStaffId,60),shift=txt(b.cashShiftId,70),pending=txt(b.pendingWork,700),stock=txt(b.stockNote,500),equipment=txt(b.equipmentNote,500),note=txt(b.note,300);
    requireInput(await realStaff(env,recipient)&&recipient!==who&&pending&&stock&&equipment);
    const cash=shift?await env.DB.prepare('SELECT id,expected_cash,opening_cash FROM pos_cash_shifts WHERE id=?').bind(shift).first():null;
    requireInput(!shift||cash,'INVALID_CASH_SHIFT');
    return insertOnce(env,deps,kind,b,actor,['cash_shift_id','from_staff_id','to_staff_id','pending_work','stock_note','equipment_note','note','expected_cash','created_at'],[cash?.id||null,who,recipient,pending,stock,equipment,note,cash?.expected_cash??null,time]);
   }
   if(kind==='correction'){
    if(!manage(actor))return bad(403,'PERMISSION_DENIED','Chỉ quản lý được điều chỉnh chấm công');
    const person=txt(b.staffId,60),reason=txt(b.reason,300),inTime=b.clockIn,outTime=b.clockOut;
    requireInput(await realStaff(env,person)&&day(b.workDate)&&clock(inTime)&&clock(outTime)&&inTime<outTime&&reason);
    const old=await env.DB.prepare('SELECT * FROM pos_attendance WHERE staff_id=? AND work_date=? ORDER BY clock_in LIMIT 1').bind(person,b.workDate).first();
    requireInput(old,'ATTENDANCE_NOT_FOUND');
    const from=new Date(b.workDate+'T'+inTime+':00+07:00').toISOString(),to=new Date(b.workDate+'T'+outTime+':00+07:00').toISOString();
    return insertOnce(env,deps,kind,b,actor,['attendance_id','staff_id','old_clock_in','old_clock_out','new_clock_in','new_clock_out','reason','actor_id','created_at'],[old.id,person,old.clock_in,old.clock_out,from,to,reason,who,time]);
   }
  }
  const state=path.match(/^\/api\/staff\/shift-ops\/(delivery|leave|task|ot|swap|handover)\/([0-9a-f-]{36})\/status$/i);
  if(state&&method==='POST'){
   const [,kind,ref]=state,b=await deps.body(req),table=tables[kind],row=await env.DB.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(ref).first();
   if(!row)return bad(404,'NOT_FOUND','Không tìm thấy mục này');
   if(kind!=='handover'&&(!Number.isSafeInteger(b.version)||b.version!==row.version))return bad(409,'SHIFT_CHANGED','Mục đã được người khác cập nhật; tải lại trước khi thao tác');
   const status=b.status,note=txt(b.note,300),manager=manage(actor);
   if(kind==='handover'){
    if(status!=='ACKNOWLEDGED'||row.acknowledged_at||row.to_staff_id!==actor.id)return bad(403,'PERMISSION_DENIED','Chỉ người nhận được xác nhận bàn giao');
    const done=await env.DB.prepare('UPDATE pos_shift_handovers SET acknowledged_at=?,acknowledged_by=? WHERE id=? AND acknowledged_at IS NULL').bind(iso(),actor.id,ref).run();
    return done.meta.changes?ok({id:ref}):bad(409,'CHANGED','Biên bản đã được xác nhận');
   }
   if(kind==='task'){
    if(!['DONE','OPEN'].includes(status)||!manager&&row.assignee_id!==actor.id)return bad(403,'PERMISSION_DENIED','Không có quyền cập nhật task');
    const done=await env.DB.prepare('UPDATE pos_shift_tasks SET status=?,completed_at=?,completed_by=?,version=version+1 WHERE id=? AND version=?').bind(status,status==='DONE'?iso():null,status==='DONE'?actor.id:null,ref,b.version).run();
    return done.meta.changes?ok({id:ref}):bad(409,'CHANGED','Task đã được cập nhật');
   }
   if(kind==='delivery'){
    if(status!=='RECEIVED'&&status!=='CANCELLED'||!manager&&!(status==='RECEIVED'&&row.receiver_id===actor.id))return bad(403,'PERMISSION_DENIED','Không có quyền nhận hoặc hủy lịch hàng');
    requireInput(status!=='RECEIVED'||note,'RECEIPT_NOTE_REQUIRED');
    const done=await env.DB.prepare("UPDATE pos_supplier_deliveries SET status=?,condition_note=?,received_at=?,received_by=?,version=version+1 WHERE id=? AND version=? AND status='SCHEDULED'").bind(status,note,status==='RECEIVED'?iso():null,status==='RECEIVED'?actor.id:null,ref,b.version).run();
    return done.meta.changes?ok({id:ref}):bad(409,'CHANGED','Lịch hàng đã đổi');
   }
   if(kind==='swap'&&status==='ACCEPTED'){
    if(row.to_staff_id!==actor.id||row.status!=='PENDING')return bad(403,'PERMISSION_DENIED','Chỉ người được đề nghị mới nhận đổi ca');
   }else if(['APPROVED','REJECTED'].includes(status)){
    if(!manager||status==='APPROVED'&&kind==='swap'&&row.status!=='ACCEPTED')return bad(403,'PERMISSION_DENIED','Chỉ quản lý duyệt sau khi người đổi ca đồng ý');
   }else if(status==='CANCELLED'){
    if(!manager&&((kind==='leave'||kind==='ot'?row.staff_id:row.from_staff_id)!==actor.id))return bad(403,'PERMISSION_DENIED','Không thể hủy yêu cầu của người khác');
   }else return bad(400,'INVALID_STATUS','Trạng thái không hợp lệ');
   if(!['leave','ot','swap'].includes(kind))return bad(400,'INVALID_STATUS','Trạng thái không hợp lệ');
   if(status==='APPROVED'&&kind==='leave'){
    const occupied=await env.DB.prepare('SELECT id FROM pos_shift_schedules WHERE staff_id=? AND work_date BETWEEN ? AND ? LIMIT 1').bind(row.staff_id,row.from_date,row.to_date).first();
    if(occupied)return bad(409,'LEAVE_SCHEDULE_CONFLICT','Cần xếp người thay và xóa ca trùng trước khi duyệt nghỉ');
   }
   const prior=kind==='swap'&&status==='APPROVED'?'ACCEPTED':'PENDING';
   const stamp=status==='ACCEPTED'?'accepted_at':'reviewed_at';
   const fields=kind==='swap'&&status==='ACCEPTED'?`status=?,${stamp}=?,version=version+1`:'status=?,reviewer_id=?,reviewed_at=?,review_note=?,version=version+1';
   const values=kind==='swap'&&status==='ACCEPTED'?[status,iso()]:[status,actor.id,iso(),note];
   const changed=await env.DB.prepare(`UPDATE ${table} SET ${fields} WHERE id=? AND version=? AND status=?`).bind(...values,ref,b.version,prior).run();
   return changed.meta.changes?ok({id:ref}):bad(409,'CHANGED','Yêu cầu đã đổi trạng thái hoặc lịch không còn hợp lệ');
  }
  return bad(404,'NOT_FOUND','Đường dẫn không tồn tại');
 }catch(e){
  const code=e?.message||'';
  if(['INVALID_SHIFT_DATA','INVALID_SWAP','INVALID_CASH_SHIFT','INVALID_VERSION','ATTENDANCE_NOT_FOUND','RECEIPT_NOTE_REQUIRED'].includes(code))return bad(400,code,'Dữ liệu không hợp lệ hoặc thiếu trường bắt buộc');
   if(/UNIQUE|constraint|SWAP_STALE|SHIFT_OVERLAP|STAFF_ON_LEAVE|LEAVE_SCHEDULE_CONFLICT|ATTENDANCE_CHANGED/i.test(code))return bad(409,'SHIFT_CONFLICT','Dữ liệu vừa thay đổi, trùng ca hoặc nhân viên đang nghỉ; tải lại trước khi thử tiếp');
  console.error('Shift operations:',code);return bad(503,'SERVICE_UNAVAILABLE','Không ghi được nghiệp vụ ca trên D1; tải lại để kiểm tra trước khi thử lại');
 }
}
