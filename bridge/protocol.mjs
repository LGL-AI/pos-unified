import net from 'node:net';

const pulse=Buffer.from([0x1b,0x70,0x00,0x19,0xfa]);
const strictBase64=value=>{
 if(typeof value!=='string'||!value.length||value.length>1500000||!(/^[A-Za-z0-9+/]+={0,2}$/.test(value))||value.length%4)return null;
 const bytes=Buffer.from(value,'base64');return bytes.toString('base64')===value?bytes:null;
};
function bitmap(data,maxHeight=3600){
 const width=Number(data?.width),height=Number(data?.height);
 if(!Number.isInteger(width)||width<8||width>576||width%8||!Number.isInteger(height)||height<8||height>maxHeight)throw Error('Kích thước ảnh in không hợp lệ');
 const bytes=strictBase64(data.bitmap);
 if(!bytes||bytes.length!==width/8*height)throw Error('Dữ liệu bitmap in không hợp lệ');
 return {width,height,bytes};
}
export function receiptBytes(payload){
 const {width,height,bytes}=bitmap(payload);
 const parts=[Buffer.from([0x1b,0x40,0x1b,0x61,0x01])];
 for(let row=0;row<height;row+=200){const rows=Math.min(height-row,200),size=width/8;parts.push(Buffer.from([0x1d,0x76,0x30,0x00,size&255,size>>8,rows&255,rows>>8]),bytes.subarray(row*size,(row+rows)*size))}
 parts.push(Buffer.from([0x0a,0x0a,0x1d,0x56,0x00]));
 return Buffer.concat(parts);
}
export function drawerBytes(){return pulse}
export function labelBytes(labels,settings){
 if(!Array.isArray(labels)||!labels.length||labels.length>60)throw Error('Chỉ in 1–60 tem mỗi lần');
 const width=Number(settings.labelWidth),height=Number(settings.labelHeight),gap=Number(settings.labelGap);
 if(!Number.isInteger(width)||width<20||width>72||!Number.isInteger(height)||height<18||height>90||!Number.isInteger(gap)||gap<0||gap>8)throw Error('Khổ tem chưa hợp lệ');
 const dots=width*8,rows=height*8;
 const parts=[];
 for(const label of labels){const image=bitmap(label,720);if(image.width!==dots||image.height!==rows)throw Error('Ảnh tem không khớp kích thước đã cài');
  parts.push(Buffer.from(`SIZE ${width} mm,${height} mm\r\nGAP ${gap} mm,0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,${image.width/8},${image.height},0,`,'ascii'),image.bytes,Buffer.from('\r\nPRINT 1,1\r\n','ascii'));
 }
 return Buffer.concat(parts);
}
export function lanIp(value){if(!net.isIPv4(value))return false;const [a,b]=value.split('.').map(Number);return a===10||a===172&&b>=16&&b<=31||a===192&&b===168}
export function sendLan(ip,port,data,timeout=6000){return new Promise((resolve,reject)=>{
 if(!lanIp(ip))return reject(Object.assign(Error('IP máy Q200 phải thuộc mạng nội bộ'),{uncertain:false}));
 let connected=false,finished=false;
 const socket=net.createConnection({host:ip,port});socket.setTimeout(timeout);
 const done=(err)=>{if(finished)return;finished=true;socket.destroy();if(err){err.uncertain=connected;reject(err)}else resolve()};
 socket.once('connect',()=>{connected=true;socket.end(data)});
 socket.once('finish',()=>done(null));
 socket.once('error',done);socket.once('timeout',()=>done(Error('Máy Q200 hết thời gian phản hồi; kiểm tra giấy trước khi in lại')));
 socket.once('close',hadError=>{if(!hadError)done(connected?null:Error('Không nối được Q200'))});
 })}
