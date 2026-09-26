import {codeForBill} from './order-code.js';
const validDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function daily(env,date){const day=date||today();if(!validDay(day))return null;
 const orders=(await env.DB.prepare("SELECT o.id,o.id AS orderId,o.code,o.table_id AS tableName,o.source,o.total,o.tax_amount AS taxAmount,o.payment_method AS method,o.paid_at AS paidAt,'ORDER' AS kind FROM qr_orders o WHERE o.payment_status='PAID' AND date(o.paid_at,'+7 hours')=? AND NOT EXISTS(SELECT 1 FROM pos_bills b WHERE b.order_id=o.id) ORDER BY o.paid_at,o.id").bind(day).all()).results;
 const bills=(await env.DB.prepare("SELECT b.id,b.order_id AS orderId,o.code AS parentCode,b.sequence,o.table_id AS tableName,o.source,b.total,b.tax_amount AS taxAmount,b.payment_method AS method,b.paid_at AS paidAt,'BILL' AS kind FROM pos_bills b JOIN qr_orders o ON o.id=b.order_id WHERE b.payment_status='PAID' AND date(b.paid_at,'+7 hours')=? ORDER BY b.paid_at,b.id").bind(day).all()).results.map(b=>({...b,code:codeForBill(b.parentCode,b.method,b.sequence)}));
 const refunds=(await env.DB.prepare("SELECT r.id,r.order_id AS orderId,r.bill_id AS billId,r.amount,r.method,r.reason,r.created_at AS createdAt FROM pos_refunds r WHERE date(r.created_at,'+7 hours')=? ORDER BY r.created_at,r.id").bind(day).all()).results;
 const payments=[...orders,...bills].sort((a,b)=>a.paidAt.localeCompare(b.paidAt)||a.id.localeCompare(b.id));
 const gross=payments.reduce((n,p)=>n+p.total,0),refunded=refunds.reduce((n,r)=>n+r.amount,0);
 const open=(await env.DB.prepare("SELECT COUNT(*) AS n FROM qr_orders WHERE payment_status!='PAID' AND status IN ('NEW','ACCEPTED','SPLIT')").first()).n;
 return {date:day,paidOrders:new Set(payments.map(x=>x.orderId)).size,paidBills:payments.length,gross,refunded,net:gross-refunded,tax:payments.reduce((n,p)=>n+(p.taxAmount||0),0),cash:payments.filter(p=>p.method==='CASH').reduce((n,p)=>n+p.total,0),bank:payments.filter(p=>p.method==='BANK').reduce((n,p)=>n+p.total,0),openOrders:open,payments,refunds};
}

// Aggregates the same paid bill/order ledger as daily(). Unpaid and split parent
// orders cannot leak into the visual report; refunds are counted on their own day.
export async function analytics(env,date){const day=date||today();if(!validDay(day))return null;
 const report=await daily(env,day),days=Array.from({length:7},(_,i)=>new Date(Date.parse(day+'T00:00:00Z')-(6-i)*86400000).toISOString().slice(0,10));
 const history=await Promise.all(days.map(async d=>{const x=await daily(env,d);return {date:d,net:x.net,gross:x.gross,refunded:x.refunded,paidBills:x.paidBills}}));
 const hours=Array.from({length:24},(_,hour)=>({hour,gross:0,refunds:0,net:0}));
 const hourOf=t=>Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',hourCycle:'h23'}).format(new Date(t)));
 for(const p of report.payments)hours[hourOf(p.paidAt)].gross+=p.total;
 for(const r of report.refunds)hours[hourOf(r.createdAt)].refunds+=r.amount;
 for(const h of hours)h.net=h.gross-h.refunds;
 const {results:topProducts=[]}=await env.DB.prepare(`SELECT sku,name,SUM(qty) AS quantity,SUM(qty*price) AS gross
 FROM (SELECT json_extract(j.value,'$.sku') AS sku,json_extract(j.value,'$.name') AS name,
 CAST(json_extract(j.value,'$.qty') AS INTEGER) AS qty,CAST(json_extract(j.value,'$.price') AS INTEGER) AS price
 FROM qr_orders o,json_each(o.items_json) j WHERE o.payment_status='PAID'
 AND date(o.paid_at,'+7 hours')=? AND NOT EXISTS(SELECT 1 FROM pos_bills b WHERE b.order_id=o.id)
 UNION ALL SELECT json_extract(j.value,'$.sku'),json_extract(j.value,'$.name'),
 CAST(json_extract(j.value,'$.qty') AS INTEGER),CAST(json_extract(j.value,'$.price') AS INTEGER)
 FROM pos_bills b JOIN qr_orders o ON o.id=b.order_id,json_each(b.items_json) j
 WHERE b.payment_status='PAID' AND date(b.paid_at,'+7 hours')=?)
 GROUP BY sku,name ORDER BY quantity DESC,gross DESC LIMIT 8`).bind(day,day).all();
 const [shifts,attendance]=await Promise.all([
  env.DB.prepare("SELECT COUNT(*) AS shifts,COALESCE(SUM(CASE WHEN status='CLOSED' THEN counted_cash-expected_cash ELSE 0 END),0) AS difference FROM pos_cash_shifts WHERE date(opened_at,'+7 hours')=?").bind(day).first(),
  env.DB.prepare('SELECT COUNT(*) AS checkIns,COUNT(DISTINCT staff_id) AS staff FROM pos_attendance WHERE work_date=?').bind(day).first()
 ]);
 // Match clock-in/out timestamps to the refund timestamp, not the day of the
 // order. Staff shown here were clocked in when the return was recorded.
 const {results:refundDetails=[]}=await env.DB.prepare(`SELECT r.id AS refundId,r.order_id AS orderId,o.code AS orderCode,
 r.amount AS refundAmount,r.reason,r.created_at AS createdAt,
 l.category,l.product_name AS productName,l.qty AS quantity,l.amount AS itemAmount,
 (SELECT group_concat(DISTINCT COALESCE(u.display_name,CASE WHEN a.staff_id='OWNER' THEN 'Chủ cửa hàng' END)) FROM pos_attendance a
 LEFT JOIN pos_staff_users u ON u.id=a.staff_id
 WHERE a.clock_in<=r.created_at AND (a.clock_out IS NULL OR a.clock_out>=r.created_at)) AS onDuty,
 COALESCE(u2.display_name,CASE WHEN r.actor_id='OWNER' THEN 'Chủ cửa hàng' END) AS recordedBy
 FROM pos_refunds r JOIN qr_orders o ON o.id=r.order_id
 LEFT JOIN pos_refund_line_items l ON l.refund_id=r.id
 LEFT JOIN pos_staff_users u2 ON u2.id=r.actor_id
 WHERE date(r.created_at,'+7 hours')=? ORDER BY r.created_at DESC,r.id,l.category`).bind(day).all();
 return {report,hours,history,topProducts,shifts,attendance,refundDetails};
}
