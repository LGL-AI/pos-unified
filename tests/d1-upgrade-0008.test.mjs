import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {upgrade} from '../scripts/upgrade-d1-0008.mjs';

const migration=n=>readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8');
const old=['0001_initial.sql','0002_customer_members_vouchers.sql','0003_pos_cloud.sql','0004_loyalty_points.sql','0005_inventory_refunds_roles.sql','0006_counter_display.sql','0007_counter_management.sql'];
function fixture(){const db=new DatabaseSync(':memory:');for(const name of old)db.exec(migration(name));db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE)');for(const name of old)db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(name);
 const query=async(sql,args=[])=>/^\s*(SELECT|PRAGMA)\b/i.test(sql)?db.prepare(sql).all(...args):(db.prepare(sql).run(...args),[]);
 return {db,query,log:()=>{}};
}
test('0008 migration upgrades 7-history D1, preserves order data and reruns safely',async()=>{
 const x=fixture();x.db.prepare("UPDATE pos_product_inventory SET stock=10 WHERE product_id='101'").run();
 await upgrade(x);assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,8);
 assert.equal(x.db.prepare('SELECT bank_account,bank_label FROM pos_store_config WHERE id=1').get().bank_account,'609271');
 x.db.prepare("UPDATE pos_store_config SET bank_account='444555666',store_name='Test shop' WHERE id=1").run();
 await upgrade(x);assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,8);assert.equal(x.db.prepare('SELECT bank_account FROM pos_store_config WHERE id=1').get().bank_account,'444555666');
 assert.equal(x.db.prepare("SELECT stock FROM pos_product_inventory WHERE product_id='101'").get().stock,10);x.db.close();
});
test('0008 resumes partial column application and records history only after schema verifies',async()=>{
 const x=fixture();x.db.exec('ALTER TABLE qr_orders ADD COLUMN bank_label TEXT NOT NULL DEFAULT \'\'');await upgrade(x);
 assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,8);assert.ok(x.db.prepare('PRAGMA table_info(qr_orders)').all().some(y=>y.name==='tax_amount'));x.db.close();
});
test('0008 refuses an unexpected migration history before changing the store schema',async()=>{
 const x=fixture();x.db.prepare("UPDATE d1_migrations SET name='unexpected.sql' WHERE id=7").run();
 await assert.rejects(upgrade(x),/history differs/);assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='pos_store_config'").get().n,0);x.db.close();
});
