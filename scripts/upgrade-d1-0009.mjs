// Safe to rerun after an interrupted upgrade; never resets recorded stock.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const id='0009_sales_independent_inventory.sql';
const expected=['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql','0006_counter_display.sql','0007_counter_management.sql','0008_store_config.sql'];
const assert=(yes,message)=>{if(!yes)throw Error(message)};
const text=readFileSync(resolve(root,'migrations',id),'utf8');
const statements=text.split(/^-- STEP \d+\s*$/gm).slice(1).map(x=>x.trim());
assert(statements.length===15,'Unexpected 0009 SQL steps');
const installed=async query=>(await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('pos_stock_new_v9','pos_stock_change_v9','pos_estimate_new_product','pos_estimate_new_ingredient','pos_estimate_product_stock_sync','pos_estimate_ingredient_stock_sync') ORDER BY name")).map(x=>x.name);

export async function upgrade({query,log=console.log}){
 const history=(await query('SELECT name FROM d1_migrations ORDER BY id')).map(x=>x.name);
 assert((history.length===8||history.length===9)&&history.slice(0,8).join('|')===expected.join('|')&&(history.length===8||history[8]===id),'Unexpected D1 history; no changes made');
 assert((await query("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('pos_products','pos_product_inventory','pos_ingredients','pos_inventory_adjustments','pos_refund_items')")).length===5,'Existing inventory tables not found; no changes made');
 if(history.length===9){assert((await installed(query)).length===6,'0009 history exists but trigger missing');return log('0009 already applied; no changes made')}
 const oldAtStart=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('pos_stock_new','pos_stock_change')");
 const canRebase=oldAtStart.length===2;
 for(let step=0;step<statements.length;step++){
  // Replacement triggers are installed first. The old triggers remain active
  // until both replacements exist, so there is no period without order accounting.
  if((step===9||step===10)&&!canRebase)continue;
  if(step===13)assert((await installed(query)).length===6,'Replacement triggers incomplete; legacy triggers kept');
  await query(statements[step]);
  log(`0009 step ${step+1}/${statements.length} verified`);
 }
 const triggers=await installed(query);
 const old=await query("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ('pos_stock_new','pos_stock_change')");
 const count=await query('SELECT COUNT(*) AS n FROM pos_inventory_estimates');
 assert(triggers.length===6&&old.length===0&&count[0].n>=22,'0009 verification failed; history not stamped');
 await query('INSERT INTO d1_migrations(name) VALUES (?)',[id]);
 log('0009 installed; orders are no longer gated by inventory. Previous orders preserved.');
}

async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 assert(account==='8973c5ef559d1c731b6c1a7b4586ca23'&&token,'GitHub secret CLOUDFLARE_D1_API_TOKEN is missing');
 const config=JSON.parse(readFileSync(resolve(root,'wrangler.jsonc'),'utf8'));
 assert(config.d1_databases.some(x=>x.database_name==='pos_unified'&&x.database_id==='4a07644e-6038-4482-a90f-e55c6c2ebd8d'),'D1 binding mismatch');
 const query=async(sql,params)=>{
  const res=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/4a07644e-6038-4482-a90f-e55c6c2ebd8d/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(params?{sql,params}:{sql})});
  const data=await res.json();assert(res.ok&&data.success&&data.result?.[0]?.success,`D1 query failed: ${JSON.stringify(data.errors||data.result?.map(x=>x.error)||[])}`);return data.result[0].results||[];
 };
 await upgrade({query});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1});
