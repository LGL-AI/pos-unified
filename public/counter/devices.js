// Only the counter browser talks to a bridge on the same counter computer.
(()=>{'use strict';
const base='http://127.0.0.1:18181';
const key='lotus-cloud:counter-bridge-token';
function token(){try{return localStorage.getItem(key)||''}catch{return ''}}
function pair(value){if(!/^[a-f0-9]{64}$/.test(value))throw Error('Mã ghép phải gồm 64 ký tự từ trang cầu in');localStorage.setItem(key,value)}
async function call(path,method='GET',value,staffToken=''){
 if(!token())throw Error('Chưa ghép cầu in. Vào Thiết bị để nhập mã ghép từ máy quầy.');
 let response;try{response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token(),...(value?{'Content-Type':'application/json'}:{}),...(staffToken?{'X-POS-Session':staffToken}:{})},body:value?JSON.stringify(value):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)})}
 catch{throw Error('Không kết nối được cầu in trên máy quầy. Kiểm tra cửa sổ cầu in và cho phép truy cập mạng cục bộ của trình duyệt. Kiểm tra giấy trước khi gửi lại.')}let data;try{data=await response.json()}catch{throw Error('Cầu in trả về dữ liệu không hợp lệ')}
 if(!response.ok||!data.ok)throw Error(data.message||'Cầu in từ chối lệnh');return data;
}
// Raster images keep Vietnamese and Chinese legible on printers with unknown code pages.
function image(lines,width,height){
 const cv=document.createElement('canvas');cv.width=width;
 const preview=cv.getContext('2d',{willReadFrequently:true});if(!preview)throw Error('Trình duyệt không hỗ trợ dựng ảnh in');
 const margin=14;let y=12;const commands=[];
 for(const line of lines){
  const size=Math.min(28,Math.max(17,line.size||20));preview.font=`${line.bold?'bold ':''}${size}px Arial, sans-serif`;
  const words=String(line.text??'').replace(/[\r\n\x00-\x1f]/g,' ').split(/\s+/);
  let current='';const wrapped=[];
  for(const word of words){if(!word)continue;const next=current?current+' '+word:word;if(preview.measureText(next).width>width-margin*2&&current){wrapped.push(current);current=word}else current=next}
  if(current)wrapped.push(current);if(!wrapped.length)wrapped.push(' ');
  for(const part of wrapped){y+=size+8;commands.push({text:part,y,size,bold:!!line.bold,center:!!line.center})}y+=line.space||0;
 }
 const finalHeight=height||Math.min(3500,Math.max(90,y+20));if(y+16>finalHeight)throw Error('Nội dung tem/hóa đơn quá dài so với giấy đã cài');cv.height=finalHeight;
 const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.fillStyle='#fff';ctx.fillRect(0,0,width,finalHeight);ctx.fillStyle='#000';ctx.textBaseline='alphabetic';
 for(const c of commands){ctx.font=`${c.bold?'bold ':''}${c.size}px Arial, sans-serif`;ctx.textAlign=c.center?'center':'left';ctx.fillText(c.text,c.center?width/2:margin,c.y)}
 const pixels=ctx.getImageData(0,0,width,finalHeight).data;
 const bytes=new Uint8Array(width/8*finalHeight);
 for(let row=0;row<finalHeight;row++)for(let col=0;col<width;col++){const i=(row*width+col)*4;if(pixels[i]<155&&pixels[i+3]>127)bytes[row*width/8+(col>>3)]|=128>>(col&7)}
 let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {width,height:finalHeight,bitmap:btoa(raw)};
}
function receipt(p){const currency=x=>new Intl.NumberFormat('vi-VN').format(Number(x)||0)+' đ';const lines=[{text:p.storeName||'LOTUS POS',size:27,bold:true,center:true,space:9},{text:'HÓA ĐƠN ĐÃ THANH TOÁN',size:22,bold:true,center:true,space:7},{text:`${p.orderCode}   ${p.table}`,bold:true},{text:'---------------------------------------------',size:17}];
 for(const item of p.items||[]){lines.push({text:`${item.qty} × ${item.name}`,bold:true});lines.push({text:currency(item.price*item.qty),space:3})}
 lines.push({text:'---------------------------------------------',size:17},{text:'Tạm tính: '+currency(p.subtotal)},{text:'Giảm: -'+currency(p.discount)},{text:(p.taxMode==='INCLUSIVE'?'Thuế đã gồm: ':'Thuế cộng thêm: ')+currency(p.taxAmount)},{text:'TỔNG: '+currency(p.total),size:27,bold:true,space:8},{text:'Đã hoàn: '+currency(p.refundedAmount)},{text:'Thanh toán: '+(p.paymentMethod==='BANK'?'Chuyển khoản':'Tiền mặt')},{text:'Đã nhận: '+currency(p.received)},{text:'Tiền thối: '+currency(p.change)},{text:new Date(p.paidAt).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'}),center:true},{text:'Cảm ơn quý khách!',center:true,space:8});return image(lines,560)
}
function labels(job,order,size){const out=[];const width=size.labelWidth*8,height=size.labelHeight*8;
 for(const item of job.items){for(let n=0;n<item.qty;n++){
  if(out.length>=60)throw Error('Phiếu vượt 60 tem; chia phiếu nhỏ hơn rồi in');
  const mods=Object.values(item.mods||{}).filter(Boolean).join(' · ');
  out.push(image([{text:order.code+' · '+order.table,size:21,bold:true},{text:item.name,size:23,bold:true},{text:mods||' ',size:16},{text:`Món ${n+1}/${item.qty} · Phiếu ${job.revision}`,size:17}],width,height));
 }}return out;
}
window.LotusCounterDevices={token,pair,status:()=>call('/api/status'),config:(staff,settings)=>call('/api/config',settings?'PUT':'GET',settings,staff),scans:(staff,after)=>call('/api/scans?after='+Number(after||0),'GET',undefined,staff),send:(job,staff)=>call('/api/jobs','POST',job,staff),receipt,labels,base};
})();
