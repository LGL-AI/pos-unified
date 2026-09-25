import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import {createBridge} from '../bridge/server.mjs';
import {receiptBytes,drawerBytes,labelBytes,lanIp,sendLan} from '../bridge/protocol.mjs';

const orderId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',billId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',jobId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const png=(w,h)=>({width:w,height:h,bitmap:Buffer.alloc(w/8*h,0xff).toString('base64')});
const receipt={type:'RECEIPT',id:'receipt:'+orderId,orderId,image:png(560,8)};
const drawer={type:'DRAWER',id:'drawer:'+orderId,orderId};
const label={type:'LABEL',id:'label:'+jobId,orderId,jobId,labels:[png(400,240)]};
const origin='https://pos-unified.lgl247-ai.workers.dev';

test('ESC/POS receipt raster, cut and drawer pulse; TSPL label starts with exact stock/gap',()=>{
 const r=receiptBytes(png(560,233));assert.deepEqual([...r.subarray(0,5)],[27,64,27,97,1]);assert.equal(r.filter((x,i)=>x===0x1d&&r[i+1]===0x76).length,2);assert.deepEqual([...r.subarray(-5)],[10,10,29,86,0]);
 assert.deepEqual([...drawerBytes()],[27,112,0,25,250]);
 const tspl=labelBytes([png(400,240)],{labelWidth:50,labelHeight:30,labelGap:2});assert.match(tspl.subarray(0,110).toString(),/SIZE 50 mm,30 mm\r\nGAP 2 mm,0 mm/);assert.ok(tspl.includes(Buffer.from('BITMAP 0,0,50,240,0,')));assert.ok(tspl.includes(Buffer.from('PRINT 1,1')));
 assert.throws(()=>labelBytes([png(400,240)],{labelWidth:35,labelHeight:30,labelGap:2}),/không khớp/);
 assert.throws(()=>receiptBytes({...png(560,8),height:9}),/bitmap/);
 assert.equal(lanIp('192.168.123.100'),true);assert.equal(lanIp('8.8.8.8'),false);assert.equal(lanIp('127.0.0.1'),false);
});

test('LAN transport refuses loopback and public IP destinations',async()=>{
 const server=net.createServer();const data=[];server.on('connection',socket=>socket.on('data',part=>data.push(part)));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await sendLan('127.0.0.1',server.address().port,drawerBytes()).then(()=>assert.fail('Only private IPs allowed'),()=>{});assert.deepEqual(data,[])}finally{server.close()}
});

test('counter bridge verifies paid D1 bill, isolates LAN/USB, deduplicates and rejects bank drawer',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lotus-bridge-test-'));const port=22000+Math.floor(Math.random()*10000),sent=[];
 let method='CASH',printedError=false;
 const cloud=async(url,options)=>new Response(JSON.stringify(url.endsWith('/api/staff/me')?{ok:true,staff:{role:'OWNER',permissions:['ORDER_VIEW','SHIFT_MANAGE']}}:{ok:true,order:{id:orderId,paymentStatus:'PAID',paymentMethod:method},bills:[{id:billId,paymentStatus:'PAID',paymentMethod:method}],jobs:[{id:jobId}]}),{status:200});
 const bridge=await createBridge({port,configPath:join(dir,'settings.json'),jobsPath:join(dir,'jobs.json'),remoteFetch:cloud,sendReceipt:async data=>{sent.push(['Q200',data]);if(printedError){printedError=false;throw Object.assign(Error('Giấy kẹt hoặc không nhận xác nhận'),{uncertain:true})}},sendLabel:async data=>sent.push(['XP365B',data])});
 const base=`http://127.0.0.1:${port}`;const request=(path,{payload,headers={},method}={})=>fetch(base+path,{method:method||(payload?'POST':'GET'),headers:{Origin:origin,Authorization:'Bearer '+bridge.settings.token,'X-POS-Session':'staff-token-valid-for-local-bridge',...(payload?{'Content-Type':'application/json'}:{}),...headers},body:payload?JSON.stringify(payload):undefined});
 try{
  let r=await fetch(base+'/setup');assert.equal(r.status,200);assert.match(await r.text(),/Cầu in POS quầy/);
  r=await fetch(base+'/setup',{method:'POST',headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({cloudOrigin:origin,receiptMethod:'LAN',receiptIp:'192.168.1.27',receiptPort:'9100',receiptPrinter:'',labelMethod:'USB',labelIp:'',labelPort:'9100',labelPrinter:'XP-365B USB',labelWidth:'50',labelHeight:'30',labelGap:'2',scannerMethod:'HID',scannerIp:'',scannerPort:'18182'})});assert.equal(r.status,200); // fetch follows the 303 redirect to setup.
  r=await request('/api/status');assert.equal((await r.json()).labelPrinter,'XP-365B USB');
  r=await request('/api/jobs',{payload:drawer});assert.equal((await r.json()).state,'SENT');assert.deepEqual([...sent[0][1]],[27,112,0,25,250]);
  r=await request('/api/jobs',{payload:drawer});assert.equal((await r.json()).reused,true);assert.equal(sent.length,1);
  r=await request('/api/jobs',{payload:receipt});assert.equal((await r.json()).state,'SENT');assert.equal(sent[1][0],'Q200');
  r=await request('/api/jobs',{payload:label});assert.equal((await r.json()).state,'SENT');assert.equal(sent[2][0],'XP365B');
  r=await request('/api/jobs',{payload:{...label,labels:[png(400,241)]}});assert.equal(r.status,409);
  r=await request('/api/jobs',{payload:{...drawer,id:'drawer:'+billId, billId},headers:{Origin:'https://evil.example'}});assert.equal(r.status,403);
  r=await request('/api/jobs',{payload:{...drawer,id:'drawer:'+billId,billId},headers:{Authorization:'Bearer wrong'}});assert.equal(r.status,401);
  method='BANK';r=await request('/api/jobs',{payload:{...drawer,id:'drawer:'+billId,billId}});assert.equal(r.status,403);assert.equal(sent.length,3);
  printedError=true;r=await request('/api/jobs',{payload:{...receipt,id:'receipt:'+billId,billId}});assert.equal(r.status,503);assert.equal((await r.json()).state,'UNKNOWN');
  r=await request('/api/jobs',{payload:{...receipt,id:'receipt:'+billId,billId}});assert.equal((await r.json()).reused,true);assert.equal(sent.length,4);
  r=await request('/api/config');assert.equal((await r.json()).settings.labelMethod,'USB');
  r=await request('/api/config',{method:'PUT',payload:{cloudOrigin:origin,receiptMethod:'WINDOWS',receiptIp:'',receiptPort:9100,receiptPrinter:'Xprinter Q200 USB',labelMethod:'USB',labelIp:'',labelPort:9100,labelPrinter:'XP-365B USB',labelWidth:50,labelHeight:30,labelGap:2,scannerMethod:'LAN',scannerIp:'192.168.1.90',scannerPort:port+1}});assert.equal(r.status,200);
  r=await request('/api/status');assert.equal((await r.json()).scannerMethod,'LAN');
  r=await request('/api/scans?after=0');assert.equal(r.status,200);assert.deepEqual((await r.json()).scans,[]);
  r=await request('/api/scans?after=0',{headers:{Origin:'https://untrusted.example'}});assert.equal(r.status,403);
 }finally{await bridge.close();await rm(dir,{recursive:true,force:true})}
});

test('counter LAN scanner receives a line and exposes it only to an authenticated POS session',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lotus-scanner-test-'));
 const port=32000+Math.floor(Math.random()*9000),scannerPort=port+1,configPath=join(dir,'config.json');
 // Loopback is allowed only in this local fixture; the settings UI requires a private LAN IP.
 await writeFile(configPath,JSON.stringify({cloudOrigin:origin,scannerMethod:'LAN',scannerIp:'127.0.0.1',scannerPort}));
 const remoteFetch=async()=>new Response(JSON.stringify({staff:{role:'OWNER',permissions:['ORDER_VIEW']}}),{status:200});
 const bridge=await createBridge({port,configPath,jobsPath:join(dir,'jobs.json'),remoteFetch});
 const base=`http://127.0.0.1:${port}`;
 try{
  await new Promise((resolve,reject)=>{const socket=net.connect(scannerPort,'127.0.0.1');socket.on('connect',()=>socket.end('PT-260924-A1B2C3D4E5\n'));socket.once('close',resolve);socket.once('error',reject)});
  const headers={Origin:origin,Authorization:'Bearer '+bridge.settings.token,'X-POS-Session':'valid-local-session'};
  const good=await fetch(base+'/api/scans?after=0',{headers});assert.equal(good.status,200);const scans=(await good.json()).scans;
  assert.equal(scans.length,1);assert.equal(scans[0].value,'PT-260924-A1B2C3D4E5');
  const later=await fetch(base+'/api/scans?after='+scans[0].sequence,{headers});assert.deepEqual((await later.json()).scans,[]);
  const denied=await fetch(base+'/api/scans?after=0',{headers:{...headers,Authorization:'Bearer incorrect'}});assert.equal(denied.status,401);
 }finally{await bridge.close();await rm(dir,{recursive:true,force:true})}
});
