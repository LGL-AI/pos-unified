// USB and Bluetooth HID scanners send text + Enter like a keyboard.
((root)=>{'use strict';
 function decode(value){
  if(typeof value!=='string'||!value.trim()||value.length>220)return null;
  let code=value.trim();
  if(/^https?:\/\//i.test(code)){
   try{const u=new URL(code);if(u.username||u.password)return null;code=u.searchParams.get('table')||u.searchParams.get('code')||''}catch{return null}
  }
  code=code.toUpperCase();
  if(/^T\d{1,2}$/.test(code)&&!/^T(?:0?[1-9]|[1-9]\d)$/.test(code))return null;
  if(/^T(?:0?[1-9]|[1-9]\d)$/.test(code)||code==='TAKEAWAY')return {kind:'TABLE',value:code};
  if(/^PT-\d{6}-[A-F0-9]{8}(?:[A-F0-9]{0,4}|-[A-F0-9]{1,4})$/.test(code))return {kind:'ORDER',value:code};
  if(/^0\d{9}$/.test(code))return {kind:'MEMBER',value:code};
  if(/^[A-Z0-9][A-Z0-9_-]{1,47}$/.test(code))return {kind:'SKU',value:code};
  return null;
 }
 root.LotusScan={decode};
})(typeof window==='undefined'?globalThis:window);
