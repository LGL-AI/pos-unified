import http from 'node:http';
import net from 'node:net';
import {readFile,rename,writeFile,mkdir,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {tmpdir} from 'node:os';
import {receiptBytes,drawerBytes,labelBytes,lanIp,sendLan} from './protocol.mjs';

const folder=dirname(fileURLToPath(import.meta.url));
const localOrigin='http://127.0.0.1:18181';
const defaults={cloudOrigin:'https://pos-unified.lgl247-ai.workers.dev',receiptMethod:'LAN',receiptIp:'',receiptPort:9100,receiptPrinter:'',labelMethod:'USB',labelIp:'',labelPort:9100,labelPrinter:'',labelWidth:50,labelHeight:30,labelGap:2,scannerMethod:'HID',scannerIp:'',scannerPort:18182,token:randomBytes(32).toString('hex')};
const validOrigin=s=>{try{const u=new URL(s);return u.origin===s&&u.protocol==='https:'&&!u.username&&!u.password}catch{return false}};
const reply=(res,status,data,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data))};
const load=async(file,fallback)=>{try{return JSON.parse(await readFile(file,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}};
async function persist(file,obj){await mkdir(dirname(file),{recursive:true});const name=file+'.tmp';await writeFile(name,JSON.stringify(obj,null,2),{mode:0o600});await rename(name,file);await chmod(file,0o600).catch(()=>{})}
async function body(req){let total=0;const parts=[];for await(const part of req){total+=part.length;if(total>4700000)throw Error('Yêu cầu in quá lớn');parts.push(part)}try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Error('JSON không hợp lệ')}}
const safeEquals=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)};
function validateSettings(data,current){const s={...current};if(!validOrigin(data.cloudOrigin))throw Error('Đường dẫn POS phải là nguồn HTTPS');s.cloudOrigin=data.cloudOrigin;
 if(data.receiptIp&&!lanIp(data.receiptIp))throw Error('Q200 phải dùng IP nội bộ, không dùng IP công cộng');s.receiptIp=data.receiptIp||'';
 if(!['LAN','WINDOWS','BLUETOOTH'].includes(data.receiptMethod))throw Error('Cách kết nối Q200 không hợp lệ');s.receiptMethod=data.receiptMethod;
 if(typeof data.receiptPrinter!=='string'||data.receiptPrinter.length>120||/[\x00-\x1f]/.test(data.receiptPrinter))throw Error('Tên máy in hóa đơn không hợp lệ');s.receiptPrinter=data.receiptPrinter;
 const port=Number(data.receiptPort);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port Q200 không hợp lệ');s.receiptPort=port;
 if(!['USB','LAN','BLUETOOTH'].includes(data.labelMethod))throw Error('Cách kết nối XP-365B không hợp lệ');s.labelMethod=data.labelMethod;
 if(data.labelIp&&!lanIp(data.labelIp))throw Error('IP máy in tem phải là mạng nội bộ');s.labelIp=data.labelIp||'';
 const labelPort=Number(data.labelPort);if(!Number.isInteger(labelPort)||labelPort<1024||labelPort>65535)throw Error('Port máy tem không hợp lệ');s.labelPort=labelPort;
 if(typeof data.labelPrinter!=='string'||data.labelPrinter.length>120||/[\x00-\x1f]/.test(data.labelPrinter))throw Error('Tên máy in tem không hợp lệ');s.labelPrinter=data.labelPrinter;
 if(!['HID','LAN'].includes(data.scannerMethod))throw Error('Cách kết nối máy quét không hợp lệ');s.scannerMethod=data.scannerMethod;
 if(data.scannerIp&&!lanIp(data.scannerIp))throw Error('IP nguồn máy quét phải nằm trong LAN');s.scannerIp=data.scannerIp||'';if(s.scannerMethod==='LAN'&&!s.scannerIp)throw Error('Máy quét LAN cần IP nguồn để chặn thiết bị lạ');
 const scannerPort=Number(data.scannerPort);if(!Number.isInteger(scannerPort)||scannerPort<1024||scannerPort>65535||scannerPort===18181)throw Error('Port máy quét không hợp lệ');s.scannerPort=scannerPort;
 for(const [key,min,max] of [['labelWidth',20,72],['labelHeight',30,90],['labelGap',0,8]]){const n=Number(data[key]);if(!Number.isInteger(n)||n<min||n>max)throw Error('Kích thước tem không hợp lệ');s[key]=n}
 return s}
function setupPage(settings){const esc=x=>String(x).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));const select=(key,values)=>`<select name="${key}">${values.map(v=>`<option value="${v}" ${settings[key]===v?'selected':''}>${v}</option>`).join('')}</select>`;return `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lotus · Cầu in quầy</title><style>body{font:16px system-ui;max-width:620px;margin:30px auto;padding:16px;background:#f4f6f2}label{display:block;margin:14px 0}input,select{width:100%;box-sizing:border-box;padding:10px;font:inherit}button{padding:12px;background:#174f42;color:white;border:0;border-radius:7px;cursor:pointer}</style><h1>Cầu in POS quầy</h1><p>Thiết lập một lần trên máy Windows rồi tiếp tục sửa các lựa chọn trong POS quầy → Thiết bị. POS cầm tay dùng máy in riêng.</p><form method="post" action="/setup"><label>Địa chỉ POS Cloud (HTTPS)<input name="cloudOrigin" value="${esc(settings.cloudOrigin)}" required></label><label>Cách kết nối hóa đơn Q200 ${select('receiptMethod',['LAN','WINDOWS','BLUETOOTH'])}</label><label>IP LAN Q200<input name="receiptIp" value="${esc(settings.receiptIp)}"></label><label>Port Q200<input name="receiptPort" type="number" value="${settings.receiptPort}"></label><label>Tên Q200 trong Windows (USB/Bluetooth)<input name="receiptPrinter" value="${esc(settings.receiptPrinter)}"></label><label>Cách kết nối tem XP-365B ${select('labelMethod',['USB','LAN','BLUETOOTH'])}</label><label>Tên máy in tem trong Windows<input name="labelPrinter" value="${esc(settings.labelPrinter)}"></label><label>IP tem nếu dùng LAN<input name="labelIp" value="${esc(settings.labelIp)}"></label><label>Port tem<input name="labelPort" type="number" value="${settings.labelPort}"></label><label>Rộng tem mm<input name="labelWidth" type="number" min="20" max="72" value="${settings.labelWidth}"></label><label>Cao tem mm<input name="labelHeight" type="number" min="30" max="90" value="${settings.labelHeight}"></label><label>Gap mm<input name="labelGap" type="number" min="0" max="8" value="${settings.labelGap}"></label><label>Máy quét ${select('scannerMethod',['HID','LAN'])}</label><label>IP máy quét LAN<input name="scannerIp" value="${esc(settings.scannerIp)}"></label><label>Port máy quét<input name="scannerPort" type="number" value="${settings.scannerPort}"></label><button>Lưu cấu hình</button></form><h2>Mã ghép máy quầy</h2><p>Chép mã này vào POS quầy → Thiết bị. Chỉ nhân viên quản lý được vào máy Windows này.</p><input id="token" readonly value="${esc(settings.token)}"><p>Két tiền cắm vào cổng DK của XP-Q200. Tín hiệu mở két đi theo kết nối Q200 đã chọn.</p></html>`}
async function spoolWindows(printer,bytes){if(process.platform!=='win32')throw Object.assign(Error('In tem USB cần máy tính Windows có driver XP-365B'),{uncertain:false});const file=join(tmpdir(),'lotus-label-'+randomBytes(10).toString('hex')+'.raw');await writeFile(file,bytes,{mode:0o600});try{await new Promise((resolve,reject)=>{execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(folder,'raw-label.ps1'),printer,file],{timeout:12000,windowsHide:true,maxBuffer:4096},(err,stdout,stderr)=>err?reject(Object.assign(Error((stderr||err.message).trim().slice(0,350)),{uncertain:true})):stdout.includes('QUEUED')?resolve():reject(Object.assign(Error('Spooler chưa xác nhận đã nhận tem'),{uncertain:true})))});}finally{const {unlink}=await import('node:fs/promises');await unlink(file).catch(()=>{})}}
async function verifyCloud(job,session,settings,remoteFetch){if(typeof session!=='string'||session.length<16||session.length>512)throw Object.assign(Error('Cần đăng nhập POS trước khi in'),{http:401});
 if(!/^[a-f\d-]{36}$/i.test(job.orderId||''))throw Object.assign(Error('Thiếu ID đơn'),{http:400});
 if(job.type==='DRAWER'&&job.id.includes(':manual:')){const role=await remoteFetch(settings.cloudOrigin+'/api/staff/me',{headers:{Authorization:'Bearer '+session},signal:AbortSignal.timeout(8000)});const info=role.ok?await role.json():{};if(!info.staff?.permissions?.includes('SHIFT_MANAGE'))throw Object.assign(Error('Chỉ quản lý ca tiền được mở két thủ công'),{http:403})}
 const r=await remoteFetch(settings.cloudOrigin+'/api/staff/orders/'+encodeURIComponent(job.orderId),{headers:{Authorization:'Bearer '+session},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Object.assign(Error('Không xác minh được đơn trên D1 ('+r.status+')'),{http:403});const d=await r.json();const o=d.order;
 if(!d.ok||o?.id!==job.orderId)throw Object.assign(Error('Dữ liệu đơn trên D1 không hợp lệ'),{http:403});
 if(job.type==='LABEL'){if(o.paymentStatus!=='PAID')throw Object.assign(Error('Chưa thanh toán, không in tem'),{http:403});if(!d.jobs?.some(j=>j.id===job.jobId&&j.status!=='VOID'))throw Object.assign(Error('Phiếu bếp không thuộc đơn'),{http:403});return}
 const x=job.billId?d.bills?.find(b=>b.id===job.billId):o;
 if(!x||x.paymentStatus!=='PAID'||(job.type==='DRAWER'&&x.paymentMethod!=='CASH'))throw Object.assign(Error('Chỉ mở két/in hóa đơn cho bill đã thanh toán đúng phương thức trên D1'),{http:403});
}
export async function createBridge({configPath=join(folder,'config.local.json'),jobsPath=join(folder,'jobs.local.json'),port=18181,remoteFetch=fetch,sendReceipt,sendLabel}={}){
 let settings={...defaults,...await load(configPath,{})};if(!settings.token||settings.token.length<32)settings.token=randomBytes(32).toString('hex');
 await persist(configPath,settings);
 const jobs=await load(jobsPath,{});for(const record of Object.values(jobs))if(record.state==='PENDING')record.state='UNKNOWN';
 await persist(jobsPath,jobs);
 let scanner=null,scannerError='',scannerSequence=0;const inbox=[];
 const recordScan=value=>{const text=value.trim();if(!text||text.length>200)return;inbox.push({sequence:++scannerSequence,value:text,at:Date.now()});while(inbox.length>40)inbox.shift()};
 async function scannerServer(config){
  if(config.scannerMethod!=='LAN')return null;
  const server=net.createServer(socket=>{
   const peer=socket.remoteAddress?.replace(/^::ffff:/,'');if(peer!==settings.scannerIp){socket.destroy();return}
   socket.setTimeout(4000);let input='';socket.on('data',chunk=>{input+=chunk.toString('utf8');if(input.length>1024){socket.destroy();return}let end;while((end=input.search(/[\r\n]/))>=0){recordScan(input.slice(0,end));input=input.slice(end+1)}});socket.on('end',()=>recordScan(input));socket.on('timeout',()=>socket.destroy());socket.on('error',()=>{});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.scannerPort,'0.0.0.0',resolve)});return server;
 }
 async function reconfigureScanner(next){if(next.scannerMethod==='LAN'&&scanner&&settings.scannerMethod==='LAN'&&next.scannerPort===settings.scannerPort)return;
  const replacement=await scannerServer(next);const old=scanner;scanner=replacement;scannerError='';old?.close();
 }
 try{await reconfigureScanner(settings)}catch(e){scannerError=e.message}
 const sendQ=sendReceipt||((bytes)=>settings.receiptMethod==='LAN'?sendLan(settings.receiptIp,settings.receiptPort,bytes):spoolWindows(settings.receiptPrinter,bytes));
 const sendL=sendLabel||((bytes)=>settings.labelMethod==='LAN'?sendLan(settings.labelIp,settings.labelPort,bytes):spoolWindows(settings.labelPrinter,bytes));let queue=Promise.resolve();
 const server=http.createServer(async(req,res)=>{
  try{
   const host=req.headers.host;if(host!==`127.0.0.1:${port}`&&host!==`localhost:${port}`)return reply(res,403,{ok:false,message:'Chỉ mở từ máy quầy'});
   const path=new URL(req.url,localOrigin).pathname;const origin=req.headers.origin;
   if(path==='/setup'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"});return res.end(setupPage(settings))}
   if(path==='/setup'&&req.method==='POST'){
    if(origin!==`http://${host}`)return reply(res,403,{ok:false,message:'Chỉ cấu hình qua trang cục bộ'});
    let text='';for await(const chunk of req){text+=chunk;if(text.length>4000)throw Error('Cấu hình quá dài')}
    const form=Object.fromEntries(new URLSearchParams(text));const next=validateSettings(form,settings);await reconfigureScanner(next);settings=next;await persist(configPath,settings);res.writeHead(303,{Location:'/setup'});return res.end()}
   if(origin!==settings.cloudOrigin)return reply(res,403,{ok:false,message:'Nguồn không được phép'});
   const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,X-POS-Session','Access-Control-Allow-Private-Network':'true','Vary':'Origin'};
   if(req.method==='OPTIONS'){res.writeHead(204,cors);return res.end()}
   if(!safeEquals(req.headers.authorization?.replace(/^Bearer /,''),settings.token))return reply(res,401,{ok:false,message:'Mã ghép cầu in không đúng'},cors);
   if(path==='/api/status'&&req.method==='GET')return reply(res,200,{ok:true,receiptIp:settings.receiptIp,receiptPort:settings.receiptPort,receiptMethod:settings.receiptMethod,receiptPrinter:settings.receiptPrinter,labelMethod:settings.labelMethod,labelIp:settings.labelIp,labelPort:settings.labelPort,labelPrinter:settings.labelPrinter,labelWidth:settings.labelWidth,labelHeight:settings.labelHeight,labelGap:settings.labelGap,scannerMethod:settings.scannerMethod,scannerIp:settings.scannerIp,scannerPort:settings.scannerPort,scannerSequence,scannerError,cloudOrigin:settings.cloudOrigin,drawerVia:'XP-Q200 '+settings.receiptMethod},cors);
   if(path==='/api/scans'&&req.method==='GET'){
    const session=req.headers['x-pos-session'];const response=await remoteFetch(settings.cloudOrigin+'/api/staff/me',{headers:{Authorization:'Bearer '+session},signal:AbortSignal.timeout(8000)});
    const who=response.ok?await response.json():{};if(!who.staff?.permissions?.some(p=>p==='ORDER_VIEW'||p==='INVENTORY_VIEW'))return reply(res,403,{ok:false,message:'Nhân viên chưa được cấp quyền tra cứu mã'},cors);
    const after=Number(new URL(req.url,localOrigin).searchParams.get('after')||0);
    if(!Number.isSafeInteger(after)||after<0)return reply(res,400,{ok:false,message:'Vị trí máy quét không hợp lệ'},cors);
    return reply(res,200,{ok:true,sequence:scannerSequence,scans:inbox.filter(x=>x.sequence>after&&Date.now()-x.at<120000).map(({sequence,value})=>({sequence,value}))},cors);
   }
   if(path==='/api/config'&&(req.method==='GET'||req.method==='PUT')){
    const session=req.headers['x-pos-session'];const response=await remoteFetch(settings.cloudOrigin+'/api/staff/me',{headers:{Authorization:'Bearer '+session},signal:AbortSignal.timeout(8000)});
    const who=response.ok?await response.json():{};if(who.staff?.role!=='OWNER')return reply(res,403,{ok:false,message:'Chỉ chủ cửa hàng được đổi cấu hình máy quầy'},cors);
    if(req.method==='PUT'){const next=validateSettings(await body(req),settings);await reconfigureScanner(next);settings=next;await persist(configPath,settings)}
    const {token:omit,...safe}=settings;return reply(res,200,{ok:true,settings:safe},cors);
   }
   if(path!=='/api/jobs'||req.method!=='POST')return reply(res,404,{ok:false,message:'Đường dẫn không tồn tại'},cors);
   const job=await body(req);
   if(!['RECEIPT','LABEL','DRAWER'].includes(job.type)||typeof job.id!=='string'||!(/^(receipt|label|drawer):[a-zA-Z\d:-]{8,150}$/.test(job.id))||!job.id.toLowerCase().startsWith(job.type.toLowerCase()+':'))return reply(res,400,{ok:false,message:'Mã công việc in không hợp lệ'},cors);
   const digest=createHash('sha256').update(JSON.stringify(job)).digest('hex');
   const prior=jobs[job.id];if(prior){if(prior.digest!==digest)return reply(res,409,{ok:false,message:'Mã công việc đã dùng với dữ liệu khác'},cors);return reply(res,200,{ok:true,state:prior.state,reused:true,message:'Đã có lệnh, không tự gửi lại'},cors)}
   if(job.type!=='LABEL'&&!(settings.receiptMethod==='LAN'?settings.receiptIp:settings.receiptPrinter)||job.type==='LABEL'&&!(settings.labelMethod==='LAN'?settings.labelIp:settings.labelPrinter))return reply(res,409,{ok:false,message:'Thiếu cấu hình máy in trên cầu in quầy'},cors);
   let bytes;try{bytes=job.type==='RECEIPT'?receiptBytes(job.image):job.type==='DRAWER'?drawerBytes():labelBytes(job.labels,settings)}catch(e){return reply(res,400,{ok:false,message:e.message},cors)}
   await verifyCloud(job,req.headers['x-pos-session'],settings,remoteFetch);
   const outcome=await (queue=queue.catch(()=>{}).then(async()=>{
    if(jobs[job.id])return {...jobs[job.id],reused:true};
    jobs[job.id]={state:'PENDING',digest,type:job.type,orderId:job.orderId,at:new Date().toISOString()};await persist(jobsPath,jobs);
    try{await (job.type==='LABEL'?sendL(bytes):sendQ(bytes));jobs[job.id].state='SENT'}catch(e){jobs[job.id].state=e.uncertain===false?'FAILED':'UNKNOWN';jobs[job.id].message=e.message}
    await persist(jobsPath,jobs);return jobs[job.id]
   }));
   return reply(res,outcome.state==='SENT'?200:503,{ok:outcome.state==='SENT',state:outcome.state,reused:!!outcome.reused,message:outcome.message||'Đã gửi lệnh; kiểm tra giấy trước khi in lại'},cors);
  }catch(e){const allowed=req.headers.origin===settings.cloudOrigin;return reply(res,e.http||500,{ok:false,message:e.message.slice(0,350)},allowed?{'Access-Control-Allow-Origin':settings.cloudOrigin,'Access-Control-Allow-Private-Network':'true','Vary':'Origin'}:{})}
 });
 await new Promise((resolve,reject)=>server.once('error',reject).listen(port,'127.0.0.1',resolve));return {server,settings,jobs,close:()=>new Promise(resolve=>{scanner?.close();server.close(resolve)})};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])createBridge().then(()=>{
 console.log('Cầu in Lotus đang chạy: http://127.0.0.1:18181/setup');
 if(process.platform==='win32')execFile('cmd.exe',['/c','start','',localOrigin+'/setup'],{windowsHide:true},()=>{});
}).catch(e=>{console.error(e);process.exitCode=1});
