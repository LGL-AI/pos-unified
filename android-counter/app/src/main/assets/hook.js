(function(){
  if(window.__lotusCounterHook || !window.LotusNative) return;
  window.__lotusCounterHook=true;
  const token=()=>localStorage.getItem('lotus-cloud:staff-session')||'';
  const original=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const requestToken=token();
    const response=await original(input,init);
    try{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      const method=(init?.method||input?.method||'GET').toUpperCase();
      if(requestToken && requestToken===token() && url.origin===location.origin && response.ok && url.pathname.startsWith('/api/staff/')){
        const body=await response.clone().json();
        if(body?.ok){
          if(method==='POST' && /^\/api\/staff\/(?:orders\/[0-9a-f-]{36}|bills\/[0-9a-f-]{36}(?:%3A|:)[1-9]\d*)\/pay$/i.test(url.pathname) && body.order?.id){
            const billId=url.pathname.includes('/bills/')?decodeURIComponent(url.pathname.split('/')[4]):'';
            const paid=billId?body.bills?.some(b=>b.id===billId&&b.paymentStatus==='PAID'):body.order.paymentStatus==='PAID';
            if(paid && requestToken===token()) window.LotusNative.paymentRecorded(body.order.id,billId,requestToken);
          }
          // The foreground UI owns the customer display. Background detail reads
          // (printing/recovery/old requests) must never switch the visible order.
        }
      }
    }catch(e){console.warn('Lotus native observer:',e)}
    return response;
  };
  setInterval(()=>{const t=token();if(t)window.LotusNative.displaySession(t)},5000);
  if(token())window.LotusNative.displaySession(token());
})();
