import test from 'node:test';
import assert from 'node:assert/strict';
import {migrations,checkD1} from '../scripts/check-d1-ready.mjs';

const remote=({history=migrations,fields=[{name:'payment_preference'}],menu=85}={})=>async sql=>{
 if(sql.includes('d1_migrations'))return history.map(name=>({name}));
 if(sql.startsWith('PRAGMA'))return fields;
 if(sql.includes('COUNT(*)'))return[{n:menu}];
 if(sql.includes('pos_store_config'))return[{id:1}];
 return [];
};

test('deploy gate accepts a complete D1 migration and menu snapshot',async()=>{
 assert.deepEqual(await checkD1(remote()),{migrations:13,echoSku:85});
});
test('deploy gate blocks code when D1 migration 0013 is not installed',async()=>{
 await assert.rejects(checkD1(remote({history:migrations.slice(0,-1)})),/chưa đủ migration/);
});
test('deploy gate blocks code when payment schema or Echo menu is missing',async()=>{
 await assert.rejects(checkD1(remote({fields:[]})),/payment_preference/);
 await assert.rejects(checkD1(remote({menu:84})),/85 SKU/);
});
