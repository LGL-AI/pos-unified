const HEAD={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:HEAD});
export const getStore=env=>env.DB.prepare('SELECT * FROM pos_store_config WHERE id=1').first();
export const publicStore=row=>({name:row.store_name,nameCn:row.store_name_cn,address:row.address,taxNumber:row.tax_number,tableCount:row.table_count,taxMode:row.tax_mode,taxRate:row.tax_rate,feedbackUrl:row.feedback_url||'https://forms.gle/Fpd7b7PdQV9kPBpf7',logo:!!row.logo_png});
export function bankSnapshot(row){return /^\d{6}$/.test(row.bank_bin||'')&&/^\d{6,24}$/.test(row.bank_account||'')&&row.bank_name?[row.bank_bin,row.bank_account,row.bank_name,row.bank_label||'']:[null,null,null,'']}
export function priceTotals(subtotal,discount,settings){
 const base=subtotal-discount;
 if(!Number.isSafeInteger(base)||base<0||base>100000000)throw Error('INVALID_TOTAL');
 const rate=Number(settings.tax_rate)||0,mode=settings.tax_mode||'INCLUSIVE';
 const taxAmount=mode==='EXCLUSIVE'?Math.round(base*rate/10000):Math.round(base*rate/(10000+rate));
 const total=base+(mode==='EXCLUSIVE'?taxAmount:0);
 if(total>100000000)throw Error('INVALID_TOTAL');return {subtotal,discount,taxAmount,taxMode:mode,taxRate:rate,total};
}
const s=(x,max)=>typeof x==='string'?x.trim().slice(0,max):'';
function parse(v,version){
 const row={storeName:s(v.storeName,100),storeNameCn:s(v.storeNameCn,100),address:s(v.address,250),taxNumber:s(v.taxNumber,30),tableCount:Number(v.tableCount),bankLabel:s(v.bankLabel,60),bankBin:s(v.bankBin,6),bankAccount:s(v.bankAccount,24).replace(/\s/g,''),bankName:s(v.bankName,100),transferPrefix:s(v.transferPrefix,8).toUpperCase(),taxMode:v.taxMode,taxRate:Number(v.taxRate),githubUrl:s(v.githubUrl,200),feedbackUrl:s(v.feedbackUrl,500),logoPng:v.logoPng};
 if(!row.storeName||row.storeName.length<2||!Number.isInteger(row.tableCount)||row.tableCount<1||row.tableCount>99||!['INCLUSIVE','EXCLUSIVE'].includes(row.taxMode)||!Number.isInteger(row.taxRate)||row.taxRate<0||row.taxRate>3000||!/^[A-Z0-9]{2,8}$/.test(row.transferPrefix)||!/^[\d-]*$/.test(row.taxNumber)||!Number.isInteger(version)||version<1)return null;
 const bank=[row.bankBin,row.bankAccount,row.bankName,row.bankLabel];if(bank.some(Boolean)&&(!/^\d{6}$/.test(bank[0])||!/^\d{6,24}$/.test(bank[1])||!bank[2]||!bank[3]))return null;
 try{const url=new URL(row.githubUrl);if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||!/^\/[A-Za-z\d_.-]+\/[A-Za-z\d_.-]+\/?$/.test(url.pathname))return null}catch{return null}
 if(row.feedbackUrl){try{const url=new URL(row.feedbackUrl);if(url.protocol!=='https:'||url.username||url.password)return null}catch{return null}}
 if(row.logoPng!==undefined&&!(row.logoPng===''||typeof row.logoPng==='string'&&/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(row.logoPng)&&row.logoPng.length<=430000))return null;
 return row;
}
export async function settingsStaff(req,env,actor,readBody){const path=new URL(req.url).pathname;if(path!=='/api/staff/store')return null;
 if(actor.role!=='OWNER')return json({ok:false,code:'OWNER_ONLY',message:'Chỉ chủ tiệm được xem và sửa cấu hình'},403);
 if(req.method==='GET'){const r=await getStore(env);return json({ok:true,store:{...publicStore(r),bankLabel:r.bank_label,bankBin:r.bank_bin,bankAccount:r.bank_account,bankName:r.bank_name,transferPrefix:r.transfer_prefix,githubUrl:r.github_url,version:r.version}})}
 if(req.method!=='PUT'&&req.method!=='POST')return json({ok:false},405);
 const b=await readBody(req),v=parse(b,b.version);if(!v)return json({ok:false,code:'INVALID_STORE',message:'Thông tin tiệm/ngân hàng/thuế không hợp lệ'},400);
 const old=await getStore(env);if(old.version!==b.version)return json({ok:false,code:'STORE_CHANGED',message:'Cấu hình đã đổi ở máy khác; tải lại'},409);
 const r=await env.DB.prepare(`UPDATE pos_store_config SET store_name=?,store_name_cn=?,address=?,tax_number=?,table_count=?,bank_label=?,bank_bin=?,bank_account=?,bank_name=?,transfer_prefix=?,tax_mode=?,tax_rate=?,github_url=?,feedback_url=?,invoice_url='',logo_png=?,updated_at=?,updated_by=?,version=version+1 WHERE id=1 AND version=?`).bind(v.storeName,v.storeNameCn,v.address,v.taxNumber,v.tableCount,v.bankLabel,v.bankBin,v.bankAccount,v.bankName,v.transferPrefix,v.taxMode,v.taxRate,v.githubUrl,v.feedbackUrl,v.logoPng===undefined?old.logo_png:v.logoPng,new Date().toISOString(),actor.id,b.version).run();
 return r.meta.changes?json({ok:true,store:{...publicStore({...old,store_name:v.storeName,store_name_cn:v.storeNameCn,address:v.address,tax_number:v.taxNumber,table_count:v.tableCount,tax_mode:v.taxMode,tax_rate:v.taxRate,feedback_url:v.feedbackUrl,invoice_url:'',logo_png:v.logoPng===undefined?old.logo_png:v.logoPng}),bankLabel:v.bankLabel,bankBin:v.bankBin,bankAccount:v.bankAccount,bankName:v.bankName,transferPrefix:v.transferPrefix,githubUrl:v.githubUrl,version:b.version+1}}):json({ok:false,code:'STORE_CHANGED',message:'Cấu hình đã đổi ở máy khác'},409);
}
export async function logoResponse(env){const r=await getStore(env);if(!r?.logo_png)return new Response('Not found',{status:404});
 if(r.logo_png==='/brands/echo-coffee.jpg')return new Response(null,{status:302,headers:{Location:'/brands/echo-coffee.jpg','Cache-Control':'no-store'}});
 const mime=r.logo_png.startsWith('data:image/jpeg;')?'image/jpeg':'image/png',data=r.logo_png.split(',')[1];
 if(!data)return new Response('Not found',{status:404});
 return new Response(Uint8Array.from(atob(data),x=>x.charCodeAt(0)),{headers:{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
