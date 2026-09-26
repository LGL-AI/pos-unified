// Code 128 B with weighted checksum and quiet zones. The result encodes the full order code.
(()=>{'use strict';
const C128=['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
function barcode(value,width=540,height=92){
 const text=String(value||'');if(!text||!/^[ -~]+$/.test(text))throw Error('Mã đơn không thể in Code 128');
 const digitsAt=i=>(text.slice(i).match(/^\d+/)||[''])[0].length;
 let i=0,mode=digitsAt(0)>=4?'C':'B';const codes=[mode==='C'?105:104];
 while(i<text.length){const n=digitsAt(i);
  if(mode==='B'&&n>=4){codes.push(99);mode='C';continue}
  if(mode==='C'&&n>=2){codes.push(Number(text.slice(i,i+2)));i+=2;continue}
  if(mode==='C'){codes.push(100);mode='B';continue}
  codes.push(text.charCodeAt(i)-32);i++;
 }
 let checksum=codes[0];
 for(let i=1;i<codes.length;i++)checksum+=codes[i]*i;codes.push(checksum%103,106);
 const total=codes.reduce((n,x)=>n+[...C128[x]].reduce((s,c)=>s+Number(c),0),20);
 const cv=document.createElement('canvas');cv.width=width;cv.height=height;
 const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,width,height);c.fillStyle='#000';
 const scale=(width-24)/total;let x=12+10*scale;
 for(const code of codes){const pattern=C128[code];for(let i=0;i<pattern.length;i++){const w=Number(pattern[i])*scale;if(i%2===0)c.fillRect(x,0,Math.max(1,w),height);x+=w}}
 return cv;
}
function qr(value,size=205){if(!value)return null;if(typeof LotusQRCode==='undefined')throw Error('Chưa nạp thư viện QR');
 const q=new LotusQRCode(-1,1);q.addData(value);q.make();const count=q.getModuleCount(),cv=document.createElement('canvas');cv.width=size;cv.height=size;
 const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,size,size);c.fillStyle='#000';const unit=size/(count+8);
 for(let y=0;y<count;y++)for(let x=0;x<count;x++)if(q.isDark(y,x))c.fillRect(Math.floor((x+4)*unit),Math.floor((y+4)*unit),Math.ceil(unit),Math.ceil(unit));return cv;
}
window.LotusPrintCodes={barcode,qr};
})();
