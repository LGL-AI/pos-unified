const endpoint=process.env.POS_CLOUDFLARE_URL||'https://pos-unified.lgl247-ai.workers.dev';
async function main(){
 for(let attempt=1;attempt<=5;attempt++){
  try{
   const response=await fetch(new URL('/api/health',endpoint),{signal:AbortSignal.timeout(8000)});
   const health=await response.json();
   if(response.ok&&health.version==='2.6.0-rc.4'&&health.d1==='ok'&&health.echoReady===true&&health.acceptingOrders===true){console.log('Worker rc.4 và D1 đã sẵn sàng nhận đơn.');return}
   console.error(`Health lần ${attempt}: version=${health.version}, d1=${health.d1}, echoReady=${health.echoReady}, acceptingOrders=${health.acceptingOrders}`);
  }catch(e){console.error(`Health lần ${attempt}: ${e.message}`)}
  if(attempt<5)await new Promise(resolve=>setTimeout(resolve,2000));
 }
 throw Error('Worker chưa sẵn sàng; kiểm tra deployment và D1, không coi triển khai thành công.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
