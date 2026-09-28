import test from 'node:test';
import assert from 'node:assert/strict';
import {migrations,checkD1} from '../scripts/check-d1-ready.mjs';

const remote=({history=migrations,fields=[{name:'payment_preference'}],menu=85,qrTable=true}={})=>async sql=>{
 if(sql.includes('d1_migrations'))return history.map(name=>({name}));
 if(sql.includes('table_info(members)'))return ['email','birthday','note','tier_override','version'].map(name=>({name}));
 if(sql.startsWith('PRAGMA'))return fields;
 if(sql.includes('COUNT(*)'))return[{n:menu}];
 if(sql.includes('pos_store_config'))return[{id:1}];
 if(sql.includes('pos_auto_print_config'))return[{since_at:'2026-09-26T00:00:00.000Z'}];
 if(sql.includes('qr_table_visits')){if(!qrTable)throw Error('no such table: qr_table_visits');return []}
 return [];
};

test('deploy gate accepts a complete D1 migration and menu snapshot',async()=>{
 assert.deepEqual(await checkD1(remote()),{migrations:15,echoSku:85});
});
test('deploy gate blocks code when D1 migration 0015 is not installed',async()=>{
 await assert.rejects(checkD1(remote({history:migrations.slice(0,-1)})),/chưa đủ migration/);
 await assert.rejects(checkD1(remote({qrTable:false})),/qr_table_visits/);
});
test('deploy gate blocks code when payment schema or Echo menu is missing',async()=>{
 await assert.rejects(checkD1(remote({fields:[]})),/payment_preference/);
 await assert.rejects(checkD1(remote({menu:84})),/85 SKU/);
});
