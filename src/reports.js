const validDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function daily(env,date){const day=date||today();if(!validDay(day))return null;
 const orders=(await env.DB.prepare("SELECT o.id,o.id AS orderId,o.code,o.table_id AS tableName,o.source,o.total,o.tax_amount AS taxAmount,o.payment_method AS method,o.paid_at AS paidAt,'ORDER' AS kind FROM qr_orders o WHERE o.payment_status='PAID' AND date(o.paid_at,'+7 hours')=? AND NOT EXISTS(SELECT 1 FROM pos_bills b WHERE b.order_id=o.id) ORDER BY o.paid_at,o.id").bind(day).all()).results;
 const bills=(await env.DB.prepare("SELECT b.id,b.order_id AS orderId,o.code||' B'||b.sequence AS code,o.table_id AS tableName,o.source,b.total,b.tax_amount AS taxAmount,b.payment_method AS method,b.paid_at AS paidAt,'BILL' AS kind FROM pos_bills b JOIN qr_orders o ON o.id=b.order_id WHERE b.payment_status='PAID' AND date(b.paid_at,'+7 hours')=? ORDER BY b.paid_at,b.id").bind(day).all()).results;
 const refunds=(await env.DB.prepare("SELECT r.id,r.order_id AS orderId,r.bill_id AS billId,r.amount,r.method,r.reason,r.created_at AS createdAt FROM pos_refunds r WHERE date(r.created_at,'+7 hours')=? ORDER BY r.created_at,r.id").bind(day).all()).results;
 const payments=[...orders,...bills].sort((a,b)=>a.paidAt.localeCompare(b.paidAt)||a.id.localeCompare(b.id));
 const gross=payments.reduce((n,p)=>n+p.total,0),refunded=refunds.reduce((n,r)=>n+r.amount,0);
 const open=(await env.DB.prepare("SELECT COUNT(*) AS n FROM qr_orders WHERE payment_status!='PAID' AND status IN ('NEW','ACCEPTED','SPLIT')").first()).n;
 return {date:day,paidOrders:new Set(payments.map(x=>x.orderId)).size,paidBills:payments.length,gross,refunded,net:gross-refunded,tax:payments.reduce((n,p)=>n+(p.taxAmount||0),0),cash:payments.filter(p=>p.method==='CASH').reduce((n,p)=>n+p.total,0),bank:payments.filter(p=>p.method==='BANK').reduce((n,p)=>n+p.total,0),openOrders:open,payments,refunds};
}
