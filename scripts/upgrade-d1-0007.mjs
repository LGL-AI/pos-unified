// GitHub Web workflow: safely import 0006/0007 using Wrangler's /import path.
// Cloudflare's /query migration splitter rejected the old multi-trigger 0005.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';

const displayName='0006_counter_display.sql',managementName='0007_counter_management.sql';
const expected=['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql'];
const assert=(condition,message)=>{if(!condition)throw Error(message)};
export async function upgrade({query,importFile,log=console.log}){
 let history=(await query('SELECT name FROM d1_migrations ORDER BY id;')).map(r=>r.name);
 assert(history.length>=5&&history.length<=7&&history.slice(0,5).join('|')===expected.join('|')&&(!history[5]||history[5]===displayName)&&(!history[6]||history[6]===managementName),`Unexpected migration history: ${history.join(', ')}`);
 const displaySchema=async()=>{
  const d=await query("SELECT name FROM sqlite_schema WHERE type='table' AND name='pos_display_sessions';");
  return d.length===1;
 };
 if(history.length===5){
  if(await displaySchema())log('0006 schema exists; verify and stamp its history.');
  else{log('Importing 0006 display schema.');await importFile(displayName)}
  assert(await displaySchema(),'0006 display table missing after import');
  await query('INSERT INTO d1_migrations(name) VALUES (?);',[displayName]);
  history.push(displayName);
 }
 assert(await displaySchema(),'0006 recorded without display table; stop before 0007');
 const objects=await query("SELECT type,name FROM sqlite_schema WHERE name IN ('pos_products','pos_shift_schedules','pos_attendance','pos_cash_shifts','pos_license_poc','pos_product_new_stock','pos_schedule_no_overlap') ORDER BY name;");
 const columns=await query('PRAGMA table_info(qr_orders);');
 const partial=objects.length>0||columns.some(r=>r.name==='voucher_terms_json');
 if(history.length===6){
  assert(!partial,'0007 appears partially installed. Inspect D1 schema before rerunning; no data was reset.');
  log('Importing 0007 catalog, voucher snapshots, schedules and attendance.');
  await importFile(managementName);
 }
 const installed=await query("SELECT type,name FROM sqlite_schema WHERE name IN ('pos_products','pos_shift_schedules','pos_attendance','pos_cash_shifts','pos_license_poc','pos_product_new_stock','pos_schedule_no_overlap') ORDER BY name;");
 assert(installed.length===7,'0007 tables or triggers missing; do not stamp history');
 const afterCols=await query('PRAGMA table_info(qr_orders);');
 assert(afterCols.some(r=>r.name==='voucher_terms_json'),'0007 voucher order snapshot column missing');
 const seeds=await query('SELECT COUNT(*) AS n FROM pos_products;');
 assert(seeds[0]?.n>=13,'0007 products were not seeded');
 if(history.length===6){await query('INSERT INTO d1_migrations(name) VALUES (?);',[managementName]);history.push(managementName)}
 const final=(await query('SELECT name FROM d1_migrations ORDER BY id;')).map(r=>r.name);
 assert(final.join('|')===[...expected,displayName,managementName].join('|'),'Migration history differs after import');
 log('0001–0007 verified; existing orders and inventory preserved.');
}

async function main(){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 assert(account==='8973c5ef559d1c731b6c1a7b4586ca23'&&token,'Cloudflare account or GitHub secret CLOUDFLARE_D1_API_TOKEN missing');
 const config=JSON.parse(readFileSync(resolve(root,'wrangler.jsonc'),'utf8'));
 assert(config.d1_databases.some(d=>d.database_name==='pos_unified'&&d.database_id==='4a07644e-6038-4482-a90f-e55c6c2ebd8d'),'D1 database ID mismatch');
 const query=async(sql,params)=>{
  const r=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/4a07644e-6038-4482-a90f-e55c6c2ebd8d/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(params?{sql,params}:{sql})});
  const data=await r.json();assert(r.ok&&data.success&&data.result?.[0]?.success,`D1 query failed: ${JSON.stringify(data.errors||data.result?.map(x=>x.error)||[])}`);return data.result[0].results||[];
 };
 const importFile=name=>execFileSync(resolve(root,'node_modules/.bin/wrangler'),['d1','execute','pos_unified','--remote',`--file=${resolve(root,'migrations',name)}`,'--yes'],{cwd:root,stdio:'inherit',env:process.env});
 await upgrade({query,importFile});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1});
