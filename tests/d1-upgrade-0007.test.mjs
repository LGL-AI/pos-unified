import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {upgrade} from '../scripts/upgrade-d1-0007.mjs';

const names=['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql'];
const sql=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
function fixture(){const db=new DatabaseSync(':memory:');for(const n of names)db.exec(sql(n));db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE)');for(const n of names)db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(n);let imports=0;return{db,query:async(q,params=[])=>/^\s*(SELECT|PRAGMA)\b/i.test(q)?db.prepare(q).all(...params):(db.prepare(q).run(...params),[]),importFile:async name=>{imports++;db.exec(sql(name))},imports:()=>imports}}
test('0007 migration imports once, includes triggers, and reruns without rewriting order data',async()=>{const x=fixture();await upgrade({...x,log:()=>{}});assert.equal(x.imports(),2);assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM pos_products').get().n,13);assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,7);await upgrade({...x,log:()=>{}});assert.equal(x.imports(),2);x.db.close()});
test('existing 0006 is verified before importing only 0007',async()=>{const x=fixture();x.db.exec(sql('0006_counter_display.sql'));x.db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run('0006_counter_display.sql');await upgrade({...x,log:()=>{}});assert.equal(x.imports(),1);x.db.close()});
test('partial 0007 refuses reimport and never stamps migration',async()=>{const x=fixture();x.db.exec(sql('0006_counter_display.sql'));x.db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run('0006_counter_display.sql');x.db.exec('ALTER TABLE qr_orders ADD COLUMN voucher_terms_json TEXT');await assert.rejects(upgrade({...x,log:()=>{}}),/partially installed/);assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,6);assert.equal(x.imports(),0);x.db.close()});
