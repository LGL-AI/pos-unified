-- Catalog, vouchers, rota and attendance on the same D1 used by all four UIs.
-- Apply after 0006. Seed products from the exact catalog bundled in release 2.2.0.
CREATE TABLE pos_products (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, name_cn TEXT NOT NULL DEFAULT '', category TEXT NOT NULL,
 station TEXT NOT NULL CHECK(station IN ('KITCHEN','BAR')),
 price INTEGER NOT NULL CHECK(price>=0 AND price<=100000000),
 large_price INTEGER NOT NULL CHECK(large_price>=0 AND large_price<=100000000),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 icon TEXT NOT NULL DEFAULT '🍚', size INTEGER NOT NULL DEFAULT 0 CHECK(size IN (0,1)),
 spicy INTEGER NOT NULL DEFAULT 0 CHECK(spicy IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL
);
CREATE INDEX idx_products_category ON pos_products(category,active);
CREATE TRIGGER pos_product_new_stock AFTER INSERT ON pos_products BEGIN
 INSERT OR IGNORE INTO pos_product_inventory(product_id,stock,min_stock) VALUES(NEW.id,0,0);
END;

-- Voucher terms stay on an existing order when an owner edits a campaign later.
ALTER TABLE qr_orders ADD COLUMN voucher_terms_json TEXT;

CREATE TABLE pos_shift_schedules (
 id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, work_date TEXT NOT NULL,
 start_time TEXT NOT NULL, end_time TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 CHECK(start_time<end_time), UNIQUE(staff_id,work_date,start_time)
);
CREATE INDEX idx_shift_schedules_date ON pos_shift_schedules(work_date,staff_id);
CREATE TRIGGER pos_schedule_no_overlap BEFORE INSERT ON pos_shift_schedules BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM pos_shift_schedules s WHERE s.staff_id=NEW.staff_id
  AND s.work_date=NEW.work_date AND s.start_time<NEW.end_time AND s.end_time>NEW.start_time)
 THEN RAISE(ABORT,'SHIFT_OVERLAP') END;
END;
CREATE TABLE pos_attendance (
 id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, work_date TEXT NOT NULL,
 clock_in TEXT NOT NULL, clock_out TEXT, status TEXT NOT NULL DEFAULT 'OPEN'
 CHECK(status IN ('OPEN','CLOSED')), note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_attendance_one_open ON pos_attendance(staff_id) WHERE status='OPEN';
CREATE INDEX idx_attendance_date ON pos_attendance(work_date,staff_id);
CREATE TABLE pos_cash_shifts (
 id TEXT PRIMARY KEY, opened_by TEXT NOT NULL, opened_at TEXT NOT NULL,
 opening_cash INTEGER NOT NULL CHECK(opening_cash>=0), status TEXT NOT NULL DEFAULT 'OPEN'
 CHECK(status IN ('OPEN','CLOSED')), closed_by TEXT, closed_at TEXT,
 counted_cash INTEGER, expected_cash INTEGER, note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_one_open_cash_shift ON pos_cash_shifts(status) WHERE status='OPEN';
-- POC license: hashed key metadata only; does not disable sales or grant rights.
CREATE TABLE pos_license_poc (
 id INTEGER PRIMARY KEY CHECK(id=1), key_hash TEXT NOT NULL,
 last_four TEXT NOT NULL, expires_on TEXT NOT NULL,
 updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
UPDATE pos_roles SET permissions_json=json_insert(permissions_json,'$[#]','SHIFT_MANAGE')
 WHERE id='MANAGER' AND NOT EXISTS (SELECT 1 FROM json_each(permissions_json) WHERE value='SHIFT_MANAGE');
UPDATE pos_roles SET permissions_json=json_insert(permissions_json,'$[#]','ATTENDANCE_VIEW')
 WHERE id='MANAGER' AND NOT EXISTS (SELECT 1 FROM json_each(permissions_json) WHERE value='ATTENDANCE_VIEW');

-- Preserves the previous release's prices and display order.
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('101','PT001','Set cơm chân giò sang trọng tối thượng','豪华至尊猪脚饭套餐','Cơm phần','KITCHEN',130000,130000,1,'🍱',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('102','PT002','Cơm giò heo vịt quay','猪脚烧鸭饭','Cơm phần','KITCHEN',100000,100000,1,'🍛',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('103','PT003','Cơm giò heo gà','猪脚鸡饭','Cơm phần','KITCHEN',100000,100000,1,'🍛',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('104','PT004','Cơm giò heo xá xíu','猪脚叉烧饭','Cơm phần','KITCHEN',100000,100000,1,'🍛',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('105','PT005','Cơm gà vịt quay','鸡烧鸭饭','Cơm phần','KITCHEN',100000,100000,1,'🍛',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('106','PT006','Cơm vịt quay xá xíu','烧鸭叉烧饭','Cơm phần','KITCHEN',100000,100000,1,'🍛',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('107','PT007','Cơm móng heo','猪蹄饭','Cơm phần','KITCHEN',90000,90000,1,'🍚',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('108','PT008','Cơm đùi vịt','鸭腿饭','Cơm phần','KITCHEN',85000,85000,1,'🍚',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('109','PT009','Cơm giò heo','猪脚饭','Cơm phần','KITCHEN',85000,85000,1,'🍚',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('110','PT010','Cơm vịt quay','烧鸭饭','Cơm phần','KITCHEN',80000,80000,1,'🍚',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('111','PT011','Cơm phá lấu','大肠饭','Cơm phần','KITCHEN',80000,80000,1,'🍚',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('112','PT012','Cơm gà Hải Nam','海南鸡饭','Cơm phần','KITCHEN',65000,65000,1,'🍗',1,1,'2026-09-24T00:00:00.000Z');
INSERT INTO pos_products(id,sku,name,name_cn,category,station,price,large_price,active,icon,size,spicy,updated_at) VALUES('113','PT013','Canh thịt lát hải sản','海鲜肉片汤','Canh','KITCHEN',60000,120000,1,'🍲',1,1,'2026-09-24T00:00:00.000Z');
