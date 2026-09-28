import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
function arg(name,fallback){const at=args.indexOf(name);return at<0?fallback:args[at+1]}
const origin=arg('--origin','https://pos-unified.lgl247-ai.workers.dev');
const count=Number(arg('--tables','99'));
const out=resolve(arg('--out',resolve(root,'table-qr')));
const url=new URL(origin);
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!Number.isInteger(count)||count<1||count>99)throw Error('Dùng --origin https://ten-may-chu và --tables từ 1 đến 99');
const context={};vm.runInNewContext(readFileSync(resolve(root,'public/assets/qrcode.js'),'utf8'),context);
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
mkdirSync(out,{recursive:true});
const records=['table,url,svg'];
for(let i=1;i<=count;i++){
 const table='T'+String(i).padStart(2,'0'),link=new URL('/qr/?table='+table,url).href;
 const qr=new context.LotusQRCode(-1,1);qr.addData(link);qr.make();
 const n=qr.getModuleCount();let modules='';
 for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))modules+=`M${x+4} ${y+4}h1v1h-1z`;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="390" viewBox="0 0 320 390" role="img" aria-label="QR gọi món ${table}"><rect width="320" height="390" fill="white"/><text x="160" y="30" text-anchor="middle" font-size="20" font-family="sans-serif" font-weight="bold">GỌI MÓN · BÀN ${table}</text><svg x="25" y="46" width="270" height="270" viewBox="0 0 ${n+8} ${n+8}"><rect width="${n+8}" height="${n+8}" fill="white"/><path fill="black" d="${modules}"/></svg><text x="160" y="342" text-anchor="middle" font-size="12" font-family="sans-serif">Quét để mở thực đơn / Scan to order</text><text x="160" y="367" text-anchor="middle" font-size="9" font-family="sans-serif">${esc(link)}</text></svg>\n`;
 writeFileSync(resolve(out,table+'.svg'),svg);
 records.push(`${table},${link},${table}.svg`);
}
writeFileSync(resolve(out,'links.csv'),records.join('\n')+'\n');
console.log(`Đã tạo ${count} QR bàn ở ${out} → ${origin}`);
