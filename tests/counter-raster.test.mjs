import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('counter browser rasterizes accented bills and individual added item labels at configured size',async()=>{
 const saved=new Map(),writes=[],bars=[];const fakeCanvas=()=>{
  const cv={width:0,height:0};const ctx={font:'',fillStyle:'',textBaseline:'',textAlign:'',measureText(text){return{width:text.length*10}},fillRect(x,y,w,h){if(this.fillStyle==='#000')bars.push([x,y,w,h])},drawImage(){},fillText(text){writes.push(text)},getImageData(){const d=new Uint8Array(cv.width*cv.height*4);d.fill(255);d[0]=0;return{data:d}}};cv.getContext=()=>ctx;return cv;
 };
 const context={window:null,localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},document:{createElement:()=>fakeCanvas()},fetch:async()=>new Response(JSON.stringify({ok:true,labelWidth:50,labelHeight:30,labelGap:2}),{status:200}),Response,AbortSignal,btoa:s=>Buffer.from(s,'latin1').toString('base64'),Intl,Date,Uint8Array,String,Number,Error,console};context.window=context;
 vm.createContext(context);vm.runInContext(readFileSync(new URL('../public/staff/qrcode.js',import.meta.url),'utf8'),context);vm.runInContext(readFileSync(new URL('../public/staff/barcode.js',import.meta.url),'utf8'),context);vm.runInContext(readFileSync(new URL('../public/counter/devices.js',import.meta.url),'utf8'),context);
 const ui=context.LotusCounterDevices;
 assert.throws(()=>ui.pair('wrong'),/64 ký tự/);
 ui.pair('a'.repeat(64));assert.equal(ui.token(),'a'.repeat(64));assert.equal((await ui.status()).labelWidth,50);
 const r=ui.receipt({storeName:'TIỆM SÍU LẬP PHÁT TÀI',orderCode:'PT-001',table:'T01',items:[{qty:2,name:'Mì sủi cảo',price:10000}],subtotal:20000,discount:0,total:20000,refundedAmount:0,paymentMethod:'CASH',received:25000,change:5000,paidAt:'2026-09-24T09:00:00Z',feedbackUrl:'https://forms.gle/Fpd7b7PdQV9kPBpf7',invoiceUrl:'https://legacy.example/invoice'});
 assert.equal(r.width,560);assert.ok(r.height>180);assert.equal(Buffer.from(r.bitmap,'base64').length,560/8*r.height);assert.ok(writes.some(t=>t.includes('Mì sủi cảo')));assert.ok(writes.some(t=>t.includes('25.000')));assert.ok(writes.some(t=>t.includes('QR góp ý')));assert.ok(!writes.some(t=>t.includes('yêu cầu xuất hóa đơn')));
 const order={code:'PT-002',table:'T02'},job={revision:2,items:[{qty:2,name:'Mì thêm',mods:{note:'Không cay'}},{qty:1,name:'Trà đá',mods:{}}]};
 const labels=ui.labels(job,order,{labelWidth:50,labelHeight:30});assert.equal(labels.length,3);assert.ok(labels.every(x=>x.width===400&&x.height===240&&Buffer.from(x.bitmap,'base64').length===12000));assert.ok(writes.includes('Món 2/2 · Phiếu 2'));assert.ok(bars.length>80,'Tem phải vẽ mã Code 128');
});
