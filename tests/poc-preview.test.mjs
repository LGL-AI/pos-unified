import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.js';

test('original POC screen and scripts are preserved with only the supplied shop logo added',()=>{
 const original=readFileSync(new URL('../data/LotusPOS_POC_VN_CN_FnB_v10_MEMBER.html',import.meta.url),'utf8');
 const preview=readFileSync(new URL('../public/counter/poc/index.html',import.meta.url),'utf8');
 const inserted=preview.match(/<img src="data:image\/jpeg;base64,[A-Za-z0-9+/=]+" alt="Echo Coffee" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">/);
 assert.ok(inserted,'shop logo must be embedded so it renders inside the isolated preview');
 assert.equal(preview.replace(inserted[0],'L'),original);
});

test('preview cannot write to production API while the four live pages retain their normal policy',async()=>{
 const env={ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname,{headers:{'Content-Type':'text/html'}})}};
 const get=path=>worker.fetch(new Request('https://pos.test'+path),env);
 const preview=await get('/counter/poc/');
 assert.equal(preview.status,200);
 assert.equal(await preview.text(),'/counter/poc/');
 const policy=preview.headers.get('Content-Security-Policy');
 assert.match(policy,/sandbox allow-scripts/);
 assert.match(policy,/connect-src 'none'/);
 assert.match(policy,/img-src 'self' data:/);
 assert.equal(preview.headers.get('X-Robots-Tag'),'noindex, nofollow');
 for(const path of ['/counter/','/display/','/staff/','/qr/']){
  const response=await get(path);
  assert.equal(response.status,200,path);
  assert.doesNotMatch(response.headers.get('Content-Security-Policy'),/sandbox/,path);
 }
});
