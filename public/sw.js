const VERSION='lotus-qr-static-v2.6.0-rc4-20260926';
const SHELL=['/','/index.html','/offline.html','/manifest.webmanifest','/catalog.json','/assets/app.css','/assets/app.js','/assets/qrcode.js','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('lotus-qr-static-')&&key!==VERSION).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;const u=new URL(req.url);if(u.origin!==self.location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/kitchen/')||u.pathname.startsWith('/staff/')||u.pathname.startsWith('/counter/')||u.pathname.startsWith('/display/')||u.pathname.includes('payment'))return;
 if(req.mode==='navigate'){event.respondWith(fetch(req).catch(async()=>await caches.match('/')||await caches.match('/offline.html')));return;}
 if(!SHELL.includes(u.pathname))return;
 event.respondWith(fetch(req).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(c=>c.put(req,copy));}return response}).catch(()=>caches.match(u.pathname)));
});
