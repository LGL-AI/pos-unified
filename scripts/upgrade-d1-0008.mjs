// Apply 0008 from a GitHub Web workflow; each statement is safe to retry.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id='0008_store_config.sql';
const history=['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql','0006_counter_display.sql','0007_counter_management.sql'];
const assert=(yes,message)=>{if(!yes)throw Error(message)};
const sql=readFileSync(resolve(root,'migrations',id),'utf8').replace(/^--[^\n]*(?:\n|$)/gm,'').split(';').map(s=>s.trim()).filter(Boolean);
assert(sql.length===10,'Unexpected 0008 statement count; check migration before running');

export async function upgrade({query,log=console.log}){
 const rows=await query('SELECT name FROM d1_migrations ORDER BY id;');const names=rows.map(x=>x.name);
 assert(names.length>=7&&names.length<=8&&names.slice(0,7).join('|')===history.join('|')&&(names.length===7||names[7]===id),'D1 migration history differs; stopped before any changes');
 const tables=await query("SELECT name FROM sqlite_schema WHERE name IN ('pos_store_config','qr_orders','pos_bills');");
 assert(tables.some(x=>x.name==='qr_orders')&&tables.some(x=>x.name==='pos_bills'),'D1 order or bill table missing');
 if(!tables.some(x=>x.name==='pos_store_config')){await query(sql[0]);log('Created store configuration table')}
 const configured=await query('SELECT id FROM pos_store_config WHERE id=1;');if(!configured.length){await query(sql[1]);log('Initialized store settings')}
 const orders=await query('PRAGMA table_info(qr_orders);');const bills=await query('PRAGMA table_info(pos_bills);');
 for(let i=0;i<6;i++){
  const target=i<5?orders:bills;const field=(i<5?['bank_label','tax_mode','tax_rate','tax_amount','transfer_prefix']:['tax_amount'])[i<5?i:0];
  if(!target.some(x=>x.name===field)){await query(sql[i+2]);log('Added '+field+' to '+(i<5?'orders':'bills'))}
 }
 const indexes=(await query("SELECT name FROM sqlite_schema WHERE type='index' AND name IN ('idx_qr_orders_paid_day','idx_pos_bills_paid_day');")).map(x=>x.name);
 if(!indexes.includes('idx_qr_orders_paid_day'))await query(sql[8]);
 if(!indexes.includes('idx_pos_bills_paid_day'))await query(sql[9]);
 const afterOrders=(await query('PRAGMA table_info(qr_orders);')).map(x=>x.name),afterBills=(await query('PRAGMA table_info(pos_bills);')).map(x=>x.name);
 assert(['bank_label','tax_mode','tax_rate','tax_amount','transfer_prefix'].every(x=>afterOrders.includes(x))&&afterBills.includes('tax_amount'),'0008 column verification failed; history was not recorded');
 const check=await query("SELECT name FROM sqlite_schema WHERE name IN ('pos_store_config','idx_qr_orders_paid_day','idx_pos_bills_paid_day');");
 assert(check.length===3,'0008 settings or indexes missing; history was not recorded');
 if(names.length===7)await query('INSERT INTO d1_migrations(name) VALUES (?);',[id]);
 const final=(await query('SELECT name FROM d1_migrations ORDER BY id;')).map(x=>x.name);
 assert(final.join('|')===[...history,id].join('|'),'0008 migration history failed verification');
 log('0001–0008 verified. Existing orders preserved.');
}

async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 assert(account==='8973c5ef559d1c731b6c1a7b4586ca23'&&token,'GitHub secret CLOUDFLARE_D1_API_TOKEN is missing');
 const config=JSON.parse(readFileSync(resolve(root,'wrangler.jsonc'),'utf8'));
 assert(config.d1_databases.some(d=>d.database_name==='pos_unified'&&d.database_id==='4a07644e-6038-4482-a90f-e55c6c2ebd8d'),'D1 database ID mismatch');
 const query=async(sqlText,params)=>{
  const res=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/4a07644e-6038-4482-a90f-e55c6c2ebd8d/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(params?{sql:sqlText,params}:{sql:sqlText})});
  const data=await res.json();assert(res.ok&&data.success&&data.result?.[0]?.success,`D1 statement failed: ${JSON.stringify(data.errors||data.result?.map(x=>x.error)||[])}`);return data.result[0].results||[];
 };
 await upgrade({query});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1});
