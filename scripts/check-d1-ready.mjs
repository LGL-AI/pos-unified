import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const migrations=readdirSync(resolve(root,'migrations')).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
const requireReady=(condition,message)=>{if(!condition)throw Error(message)};

// Read-only gate. The 0009 upgrade must use its dedicated resumable script.
export async function checkD1(query){
 const history=(await query('SELECT name FROM d1_migrations ORDER BY id')).map(x=>x.name);
 requireReady(history.length===migrations.length&&history.every((name,i)=>name===migrations[i]),`D1 chưa đủ migration 0001–0013. Hiện có: ${history.join(', ')||'(trống)'}`);
 const fields=await query('PRAGMA table_info(qr_orders)');
 requireReady(fields.some(x=>x.name==='payment_preference'),'D1 thiếu cột payment_preference trong qr_orders');
 const store=await query('SELECT id FROM pos_store_config WHERE id=1');
 requireReady(store.length===1,'D1 thiếu cấu hình cửa tiệm');
 await query('SELECT id FROM pos_service_requests LIMIT 1');
 await query('SELECT id FROM pos_shift_tasks LIMIT 1');
 await query('SELECT option_code FROM pos_menu_options LIMIT 1');
 const menu=await query("SELECT COUNT(*) AS n FROM pos_products WHERE id LIKE 'EC_%' AND active=1");
 requireReady(Number(menu[0]?.n)>=85,'D1 chưa có đủ 85 SKU Echo đang bán');
 return {migrations:history.length,echoSku:Number(menu[0].n)};
}

async function main(){
 const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
 requireReady(account&&token,'Cần CLOUDFLARE_ACCOUNT_ID và CLOUDFLARE_API_TOKEN để kiểm D1 thật');
 const config=JSON.parse(readFileSync(resolve(root,'wrangler.jsonc'),'utf8'));
 const database=config.d1_databases?.find(x=>x.binding==='DB'&&x.database_name==='pos_unified')?.database_id;
 requireReady(database,'Không tìm thấy binding DB/pos_unified trong wrangler.jsonc');
 const query=async sql=>{
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(database)}/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({sql})});
  const body=await response.json();
  requireReady(response.ok&&body.success&&body.result?.[0]?.success,`Không kiểm được D1 thật: ${body.errors?.[0]?.message||body.result?.[0]?.error||response.status}`);
  return body.result[0].results||[];
 };
 if(process.argv.includes('--through-0009')){
  const history=(await query('SELECT name FROM d1_migrations ORDER BY id')).map(x=>x.name);
  requireReady(history.length>=9&&history.slice(0,9).every((name,i)=>name===migrations[i]),'Phải chạy nâng cấp 0009 bằng script riêng trước khi áp 0010–0013');
  requireReady(history.length===9,'D1 đang nâng cấp dở hoặc đã có migration sau 0009; kiểm tra lịch sử trước khi tiếp tục');
  console.log('D1 đã áp đúng 0001–0009; có thể áp 0010–0013.');return;
 }
 const result=await checkD1(query);
 console.log(`D1 thật sẵn sàng: ${result.migrations} migration, ${result.echoSku} SKU Echo đang bán.`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1});
