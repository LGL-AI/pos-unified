// Recover a D1 database with 0001-0004 applied and 0005 still pending.
// D1's /query statement splitter can reject a valid multi-trigger migration;
// Wrangler's remote --file import uses D1's separate /import parser instead.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';

export const firstFour = [
  '0001_initial.sql', '0002_customer_members_vouchers.sql',
  '0003_pos_cloud.sql', '0004_loyalty_points.sql',
];
export const fifth = '0005_inventory_refunds_roles.sql';

const expectedObjects = {
  table: [
    'pos_roles', 'pos_staff_users', 'pos_product_inventory', 'pos_ingredients',
    'pos_recipes', 'pos_inventory_movements', 'pos_restock_plans',
    'pos_inventory_adjustments', 'pos_refunds', 'pos_refund_items',
  ],
  trigger: [
    'pos_adjust_guard', 'pos_adjust_commit', 'pos_stock_new',
    'pos_stock_change', 'pos_refund_guard', 'pos_refund_loyalty',
    'pos_refund_stock_guard', 'pos_refund_stock',
  ],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function schemaReady(query) {
  const rows = await query("SELECT type,name FROM sqlite_schema WHERE type IN ('table','trigger') AND name LIKE 'pos_%' ORDER BY type,name;");
  const actual = new Set(rows.map(({type,name}) => `${type}:${name}`));
  for (const [type,names] of Object.entries(expectedObjects)) {
    for (const name of names) assert(actual.has(`${type}:${name}`), `0005 missing ${type}: ${name}`);
  }
  const [orders, sessions] = await Promise.all([
    query('PRAGMA table_info(qr_orders);'),
    query('PRAGMA table_info(pos_staff_sessions);'),
  ]);
  assert(orders.some(({name}) => name === 'inventory_tracked'), '0005 missing qr_orders.inventory_tracked');
  assert(sessions.some(({name}) => name === 'staff_id'), '0005 missing pos_staff_sessions.staff_id');
  const seeded = await query('SELECT (SELECT COUNT(*) FROM pos_product_inventory) AS products, (SELECT COUNT(*) FROM pos_ingredients) AS ingredients, (SELECT COUNT(*) FROM pos_roles) AS roles;');
  assert(seeded.length === 1 && seeded[0].products === 13 && seeded[0].ingredients === 9 && seeded[0].roles === 4,
    '0005 seed data is incomplete');
}

export async function finish({query,importFile,log = console.log}) {
  const history = (await query('SELECT name FROM d1_migrations ORDER BY id;')).map(({name}) => name);
  assert(history.slice(0,4).join('|') === firstFour.join('|'), `Unexpected D1 history: ${history.join(', ')}`);
  if (history.length === 5 && history[4] === fifth) {
    await schemaReady(query);
    log('All five migrations are already applied. No import needed.');
    return;
  }
  assert(history.length === 4, `Unexpected D1 history: ${history.join(', ')}`);
  // An unsuccessful /import could be partial. Any 0005 object or new column
  // requires inspection, never a blind second ALTER TABLE / import.
  const existing = await query("SELECT type,name FROM sqlite_schema WHERE type IN ('table','trigger') AND name LIKE 'pos_%' ORDER BY type,name;");
  const fifthNames = new Set(Object.values(expectedObjects).flat());
  const conflicting = existing.filter(({name}) => fifthNames.has(name));
  const [orders, sessions] = await Promise.all([
    query('PRAGMA table_info(qr_orders);'),
    query('PRAGMA table_info(pos_staff_sessions);'),
  ]);
  assert(conflicting.length === 0 && !orders.some(({name}) => name === 'inventory_tracked') && !sessions.some(({name}) => name === 'staff_id'),
    `0005 appears partially installed (${conflicting.map(({name}) => name).join(', ') || 'new column'}); do not re-import. Inspect D1 first.`);

  log('0001-0004 confirmed; 0005 is absent. Importing 0005 SQL file.');
  await importFile();
  await schemaReady(query);
  log('0005 tables, triggers, columns and seed data verified. Recording migration history.');
  await query('INSERT INTO d1_migrations(name) VALUES (?);', [fifth]);
  const after = (await query('SELECT name FROM d1_migrations ORDER BY id;')).map(({name}) => name);
  assert(after.join('|') === [...firstFour,fifth].join('|'), `Unexpected D1 history after import: ${after.join(', ')}`);
  log('All five migrations applied and verified.');
}

async function main() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert(account === '8973c5ef559d1c731b6c1a7b4586ca23', 'Cloudflare account ID does not match this database');
  assert(Boolean(token), 'GitHub secret CLOUDFLARE_D1_API_TOKEN is missing');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const config = JSON.parse(readFileSync(resolve(root,'wrangler.jsonc'),'utf8'));
  const db = config.d1_databases.find(({database_name}) => database_name === 'pos_unified');
  assert(db?.database_id === '4a07644e-6038-4482-a90f-e55c6c2ebd8d', 'D1 database ID mismatch');
  const migrationPath = resolve(root,'migrations',fifth);
  assert(!readFileSync(migrationPath).includes(13), 'SQL file must use LF line endings');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db.database_id}/query`;
  const query = async (sql,params) => {
    const response = await fetch(url, {
      method:'POST',
      headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json'},
      body:JSON.stringify(params ? {sql,params} : {sql}),
    });
    const data = await response.json();
    assert(response.ok && data.success && Array.isArray(data.result) && data.result[0]?.success,
      `D1 query failed: ${JSON.stringify(data.errors || data.result?.map(x=>x.error) || [])}`);
    return data.result[0].results || [];
  };
  const importFile = () => execFileSync(resolve(root,'node_modules/.bin/wrangler'),
    ['d1','execute','pos_unified','--remote',`--file=${migrationPath}`,'--yes'],
    {cwd:root,stdio:'inherit',env:process.env});
  await finish({query,importFile});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {console.error(error.message);process.exitCode = 1;});
}
