import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {finish,firstFour,fifth} from '../scripts/finish-d1-0005.mjs';

function existingDatabase() {
  const db = new DatabaseSync(':memory:');
  for (const name of firstFour) db.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
  db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);');
  for (const name of firstFour) db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').run(name);
  const query = async (sql,params=[]) => {
    const stmt = db.prepare(sql);
    return /^\s*(SELECT|PRAGMA)\b/i.test(sql) ? stmt.all(...params) : (stmt.run(...params),[]);
  };
  const importFile = () => db.exec(readFileSync(new URL(`../migrations/${fifth}`,import.meta.url),'utf8'));
  return {db,query,importFile};
}

test('recovery imports only pending 0005, verifies schema, stamps history and safely rechecks',async()=>{
  const {db,query,importFile}=existingDatabase();
  let imports=0;
  await finish({query,importFile:()=>{imports++;return importFile()},log:()=>{}});
  assert.equal(imports,1);
  assert.deepEqual(db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(({name})=>name),[...firstFour,fifth]);
  await finish({query,importFile:()=>{imports++;return importFile()},log:()=>{}});
  assert.equal(imports,1);
  db.close();
});

test('partial 0005 schema stops recovery before importing again or recording history',async()=>{
  const {db,query,importFile}=existingDatabase();
  db.exec('ALTER TABLE qr_orders ADD COLUMN inventory_tracked INTEGER NOT NULL DEFAULT 0;');
  await assert.rejects(finish({query,importFile,log:()=>{}}),/partially installed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n,4);
  db.close();
});

test('unexpected migration history stops recovery before touching the database',async()=>{
  const {db,query,importFile}=existingDatabase();
  db.exec('DELETE FROM d1_migrations WHERE id=4;');
  await assert.rejects(finish({query,importFile,log:()=>{}}),/Unexpected D1 history/);
  db.close();
});
