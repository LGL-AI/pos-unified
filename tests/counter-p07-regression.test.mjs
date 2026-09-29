import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('counter compatibility guards: explicit popup edges and Android JS dialog support',()=>{
 const css=readFileSync(new URL('../public/staff/staff.css',import.meta.url),'utf8');
 const overlay=css.match(/\.item-overlay\{([^}]+)\}/)[1];
 for(const edge of ['top','right','bottom','left'])assert.match(overlay,new RegExp(`${edge}:0`));
 const java=readFileSync(new URL('../android-counter/app/src/main/java/vn/lotusai/pos/counter/MainActivity.java',import.meta.url),'utf8');
 assert.match(java,/setWebChromeClient\(new WebChromeClient\(\)\)/);
 assert.match(java,/window\.LotusCounterBack/);
 assert.match(java,/@JavascriptInterface public void reconnectDisplay\(\)/);
});
