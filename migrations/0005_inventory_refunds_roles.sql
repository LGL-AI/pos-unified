-- New cloud operations. Existing orders remain intact and are NOT back-deducted.
ALTER TABLE qr_orders ADD COLUMN inventory_tracked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pos_staff_sessions ADD COLUMN staff_id TEXT;
-- Previous shared-password sessions had unrestricted owner access; require login again.
DELETE FROM pos_staff_sessions;

CREATE TABLE pos_roles (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, permissions_json TEXT NOT NULL,
 system INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO pos_roles VALUES
 ('OWNER','Chủ cửa hàng','["ORDER_VIEW","ORDER_EDIT","PAYMENT_CONFIRM","PRINT_KITCHEN","INVENTORY_VIEW","INVENTORY_MANAGE","REFUND_VIEW","REFUND_CREATE","STAFF_MANAGE","ROLE_MANAGE"]',1,1),
 ('MANAGER','Quản lý','["ORDER_VIEW","ORDER_EDIT","PAYMENT_CONFIRM","PRINT_KITCHEN","INVENTORY_VIEW","INVENTORY_MANAGE","REFUND_VIEW","REFUND_CREATE"]',1,1),
 ('CASHIER','Thu ngân','["ORDER_VIEW","ORDER_EDIT","PAYMENT_CONFIRM","PRINT_KITCHEN","INVENTORY_VIEW","REFUND_VIEW"]',1,1),
 ('KITCHEN','Bếp','["ORDER_VIEW","PRINT_KITCHEN"]',1,1);
CREATE TABLE pos_staff_users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL, role_id TEXT NOT NULL REFERENCES pos_roles(id),
 password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_staff_role ON pos_staff_users(role_id,active);

CREATE TABLE pos_product_inventory (
 product_id TEXT PRIMARY KEY, stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0),
 min_stock INTEGER NOT NULL DEFAULT 0 CHECK(min_stock>=0)
);
INSERT INTO pos_product_inventory(product_id) VALUES
 ('101'),('102'),('103'),('104'),('105'),('106'),('107'),
 ('108'),('109'),('110'),('111'),('112'),('113');
CREATE TABLE pos_ingredients (
 id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_cn TEXT NOT NULL,
 unit TEXT NOT NULL CHECK(unit IN ('g','ml')),
 stock INTEGER NOT NULL DEFAULT 0 CHECK(stock>=0), min_stock INTEGER NOT NULL DEFAULT 0 CHECK(min_stock>=0)
);
INSERT INTO pos_ingredients(id,sku,name,name_cn,unit,min_stock) VALUES
 ('ING-PORK-HOCK','NL019','Giò heo','猪脚','g',5000),
 ('ING-DUCK','NL020','Vịt quay','烧鸭','g',5000),
 ('ING-CHICKEN','NL013','Thịt gà','鸡肉','g',4500),
 ('ING-RICE','NL014','Gạo','大米','g',7000),
 ('ING-CHARSIU','NL021','Xá xíu','叉烧','g',4000),
 ('ING-INTESTINE','NL022','Phá lấu','卤大肠','g',3000),
 ('ING-SEAFOOD','NL023','Hải sản','海鲜','g',3000),
 ('ING-PORK-SLICE','NL024','Thịt lát','肉片','g',3000),
 ('ING-BROTH','NL017','Nước dùng','汤底','ml',5500);
CREATE TABLE pos_recipes (
 product_id TEXT NOT NULL REFERENCES pos_product_inventory(product_id),
 ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
 qty INTEGER NOT NULL CHECK(qty>0), PRIMARY KEY(product_id,ingredient_id)
);
-- Exactly the 13 menu recipes of the offline handheld build; qty per portion in g/ml.
INSERT INTO pos_recipes VALUES
 ('101','ING-PORK-HOCK',180),('101','ING-DUCK',120),('101','ING-CHICKEN',120),('101','ING-RICE',250),
 ('102','ING-PORK-HOCK',160),('102','ING-DUCK',120),('102','ING-RICE',250),
 ('103','ING-PORK-HOCK',160),('103','ING-CHICKEN',120),('103','ING-RICE',250),
 ('104','ING-PORK-HOCK',160),('104','ING-CHARSIU',120),('104','ING-RICE',250),
 ('105','ING-CHICKEN',120),('105','ING-DUCK',120),('105','ING-RICE',250),
 ('106','ING-DUCK',120),('106','ING-CHARSIU',120),('106','ING-RICE',250),
 ('107','ING-PORK-HOCK',200),('107','ING-RICE',250),
 ('108','ING-DUCK',220),('108','ING-RICE',250),
 ('109','ING-PORK-HOCK',180),('109','ING-RICE',250),
 ('110','ING-DUCK',180),('110','ING-RICE',250),
 ('111','ING-INTESTINE',180),('111','ING-RICE',250),
 ('112','ING-CHICKEN',180),('112','ING-RICE',250),
 ('113','ING-SEAFOOD',150),('113','ING-PORK-SLICE',100),('113','ING-BROTH',350);

CREATE TABLE pos_inventory_movements (
 id TEXT PRIMARY KEY, product_id TEXT, ingredient_id TEXT, qty INTEGER NOT NULL,
 kind TEXT NOT NULL, reference TEXT NOT NULL, actor_id TEXT,
 order_id TEXT REFERENCES qr_orders(id), created_at TEXT NOT NULL,
 CHECK((product_id IS NULL)!=(ingredient_id IS NULL))
);
CREATE INDEX idx_inventory_movements_recent ON pos_inventory_movements(created_at DESC);
CREATE TABLE pos_restock_plans (
 id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES pos_ingredients(id),
 qty INTEGER NOT NULL CHECK(qty>0), due_date TEXT NOT NULL,
 supplier TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PLANNED'
 CHECK(status IN ('PLANNED','RECEIVED','CANCELLED')),
 actor_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE pos_inventory_adjustments (
 id TEXT PRIMARY KEY, product_id TEXT, ingredient_id TEXT,
 delta INTEGER NOT NULL CHECK(delta!=0), kind TEXT NOT NULL
 CHECK(kind IN ('RECEIPT','ADJUST_PLUS','ADJUST_MINUS')),
 reference TEXT NOT NULL, actor_id TEXT NOT NULL,
 idem_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 plan_id TEXT UNIQUE REFERENCES pos_restock_plans(id), created_at TEXT NOT NULL,
 CHECK((product_id IS NULL)!=(ingredient_id IS NULL))
);
CREATE TRIGGER pos_adjust_guard BEFORE INSERT ON pos_inventory_adjustments BEGIN
 SELECT (CASE WHEN NEW.delta<0 AND NEW.kind!='ADJUST_MINUS' OR NEW.delta>0 AND NEW.kind='ADJUST_MINUS'
   THEN RAISE(ABORT,'INVALID_ADJUSTMENT') END);
 SELECT (CASE WHEN NEW.product_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM pos_product_inventory WHERE product_id=NEW.product_id AND stock+NEW.delta>=0)
   THEN RAISE(ABORT,'STOCK_CANNOT_BE_NEGATIVE') END);
 SELECT (CASE WHEN NEW.ingredient_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM pos_ingredients WHERE id=NEW.ingredient_id AND stock+NEW.delta>=0)
   THEN RAISE(ABORT,'STOCK_CANNOT_BE_NEGATIVE') END);
 SELECT (CASE WHEN NEW.plan_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM pos_restock_plans WHERE id=NEW.plan_id AND ingredient_id=NEW.ingredient_id AND qty=NEW.delta AND status='PLANNED')
   THEN RAISE(ABORT,'PLAN_CHANGED') END);
END;
CREATE TRIGGER pos_adjust_commit AFTER INSERT ON pos_inventory_adjustments BEGIN
 UPDATE pos_product_inventory SET stock=stock+NEW.delta WHERE product_id=NEW.product_id;
 UPDATE pos_ingredients SET stock=stock+NEW.delta WHERE id=NEW.ingredient_id;
 UPDATE pos_restock_plans SET status='RECEIVED' WHERE id=NEW.plan_id;
 INSERT INTO pos_inventory_movements(id,product_id,ingredient_id,qty,kind,reference,actor_id,created_at)
 VALUES('adjust:'||NEW.id,NEW.product_id,NEW.ingredient_id,NEW.delta,NEW.kind,NEW.reference,NEW.actor_id,NEW.created_at);
END;

-- JSON items are priced/validated in the Worker. These triggers serialize stock
-- checks with the INSERT/UPDATE, so two devices cannot consume the same units.
CREATE TRIGGER pos_stock_new AFTER INSERT ON qr_orders WHEN NEW.inventory_tracked=1 BEGIN
 SELECT (CASE WHEN EXISTS (
   SELECT 1 FROM pos_product_inventory p WHERE p.product_id IN
     (SELECT CAST(json_extract(value,'$.productId') AS TEXT) FROM json_each(NEW.items_json))
   AND p.stock < (SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(NEW.items_json)
                   WHERE CAST(json_extract(value,'$.productId') AS TEXT)=p.product_id)
 ) THEN RAISE(ABORT,'OUT_OF_STOCK') END);
 SELECT (CASE WHEN EXISTS (
   SELECT 1 FROM pos_ingredients ing WHERE ing.id IN
     (SELECT ingredient_id FROM pos_recipes WHERE product_id IN
       (SELECT CAST(json_extract(value,'$.productId') AS TEXT) FROM json_each(NEW.items_json)))
   AND ing.stock < (SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty)
     FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT)
     WHERE r.ingredient_id=ing.id)
 ) THEN RAISE(ABORT,'INGREDIENT_OUT_OF_STOCK') END);
 UPDATE pos_product_inventory SET stock=stock-
   (SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(NEW.items_json)
    WHERE CAST(json_extract(value,'$.productId') AS TEXT)=product_id)
 WHERE product_id IN (SELECT CAST(json_extract(value,'$.productId') AS TEXT) FROM json_each(NEW.items_json));
 UPDATE pos_ingredients SET stock=stock-
   (SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty)
    FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT)
    WHERE r.ingredient_id=pos_ingredients.id)
 WHERE id IN (SELECT r.ingredient_id FROM json_each(NEW.items_json) j JOIN pos_recipes r
   ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT));
 INSERT INTO pos_inventory_movements(id,product_id,qty,kind,reference,order_id,created_at)
 SELECT 'order:'||NEW.id||':1:product:'||p.product_id,p.product_id,
   -SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)),'ORDER_ESTIMATE',NEW.code,NEW.id,NEW.created_at
 FROM json_each(NEW.items_json) j JOIN pos_product_inventory p ON p.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT)
 GROUP BY p.product_id;
 INSERT INTO pos_inventory_movements(id,ingredient_id,qty,kind,reference,order_id,created_at)
 SELECT 'order:'||NEW.id||':1:ingredient:'||r.ingredient_id,r.ingredient_id,
   -SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty),'ORDER_ESTIMATE',NEW.code,NEW.id,NEW.created_at
 FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT)
 GROUP BY r.ingredient_id;
END;

-- For pre-migration orders inventory_tracked=0: cancellation does not invent stock.
-- If a legacy order is appended, that UPDATE opts in and accounts for all its items.
CREATE TRIGGER pos_stock_change AFTER UPDATE OF items_json ON qr_orders
WHEN NEW.kitchen_revision>OLD.kitchen_revision AND (NEW.inventory_tracked=1 OR OLD.inventory_tracked=1)
BEGIN
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM pos_product_inventory p WHERE
    p.stock + CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(OLD.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=p.product_id),0) ELSE 0 END
    - CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(NEW.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=p.product_id),0) ELSE 0 END < 0
 ) THEN RAISE(ABORT,'OUT_OF_STOCK') END);
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM pos_ingredients ing WHERE
   ing.stock + CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(OLD.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=ing.id),0) ELSE 0 END
   - CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=ing.id),0) ELSE 0 END < 0
 ) THEN RAISE(ABORT,'INGREDIENT_OUT_OF_STOCK') END);
 UPDATE pos_product_inventory SET stock=stock
   + CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(OLD.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=product_id),0) ELSE 0 END
   - CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(NEW.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=product_id),0) ELSE 0 END;
 UPDATE pos_ingredients SET stock=stock
   + CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(OLD.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=pos_ingredients.id),0) ELSE 0 END
   - CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=pos_ingredients.id),0) ELSE 0 END;
 INSERT INTO pos_inventory_movements(id,product_id,qty,kind,reference,order_id,created_at)
 SELECT 'order:'||NEW.id||':'||NEW.kitchen_revision||':product:'||p.product_id,p.product_id,
   (CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(OLD.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=p.product_id),0) ELSE 0 END)
   - (CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(NEW.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=p.product_id),0) ELSE 0 END),
   CASE WHEN NEW.status='CANCELLED' THEN 'ORDER_CANCEL' WHEN NEW.last_change_kind='CANCEL' THEN 'UNIT_CANCEL' ELSE 'ORDER_ADD' END,NEW.code,NEW.id,NEW.updated_at
 FROM pos_product_inventory p WHERE
   (CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(OLD.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=p.product_id),0) ELSE 0 END)
   != (CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(NEW.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=p.product_id),0) ELSE 0 END);
 INSERT INTO pos_inventory_movements(id,ingredient_id,qty,kind,reference,order_id,created_at)
 SELECT 'order:'||NEW.id||':'||NEW.kitchen_revision||':ingredient:'||ing.id,ing.id,
   (CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(OLD.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=ing.id),0) ELSE 0 END)
   - (CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=ing.id),0) ELSE 0 END),
   CASE WHEN NEW.status='CANCELLED' THEN 'ORDER_CANCEL' WHEN NEW.last_change_kind='CANCEL' THEN 'UNIT_CANCEL' ELSE 'ORDER_ADD' END,NEW.code,NEW.id,NEW.updated_at
 FROM pos_ingredients ing WHERE
   (CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(OLD.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=ing.id),0) ELSE 0 END)
   != (CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=ing.id),0) ELSE 0 END);
END;

CREATE TABLE pos_refunds (
 id TEXT PRIMARY KEY, idem_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 order_id TEXT NOT NULL REFERENCES qr_orders(id), bill_id TEXT REFERENCES pos_bills(id),
 amount INTEGER NOT NULL CHECK(amount>0), reason TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN ('CASH','BANK')),
 actor_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_refunds_order ON pos_refunds(order_id,created_at);
CREATE TRIGGER pos_refund_guard BEFORE INSERT ON pos_refunds BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM qr_orders WHERE id=NEW.order_id AND status='PAID' AND payment_status='PAID')
   THEN RAISE(ABORT,'ORDER_NOT_PAID') END);
 SELECT (CASE WHEN (SELECT status FROM qr_orders WHERE id=NEW.order_id)='PAID'
   AND EXISTS(SELECT 1 FROM pos_bills WHERE order_id=NEW.order_id) AND NEW.bill_id IS NULL
   THEN RAISE(ABORT,'REFUND_BILL_REQUIRED') END);
 SELECT (CASE WHEN NEW.bill_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pos_bills WHERE id=NEW.bill_id AND order_id=NEW.order_id)
   THEN RAISE(ABORT,'REFUND_BILL_INVALID') END);
 SELECT (CASE WHEN NEW.amount > (SELECT total-COALESCE((SELECT SUM(amount) FROM pos_refunds WHERE order_id=NEW.order_id),0) FROM qr_orders WHERE id=NEW.order_id)
   THEN RAISE(ABORT,'REFUND_EXCEEDS_PAID') END);
 SELECT (CASE WHEN NEW.bill_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pos_bills b WHERE b.id=NEW.bill_id AND b.order_id=NEW.order_id AND b.payment_status='PAID'
    AND NEW.amount<=b.total-COALESCE((SELECT SUM(amount) FROM pos_refunds WHERE bill_id=NEW.bill_id),0))
   THEN RAISE(ABORT,'REFUND_EXCEEDS_BILL') END);
END;
CREATE TRIGGER pos_refund_loyalty AFTER INSERT ON pos_refunds BEGIN
 UPDATE members SET points=points
   + CAST(((SELECT total FROM qr_orders WHERE id=NEW.order_id)-(SELECT SUM(amount) FROM pos_refunds WHERE order_id=NEW.order_id))/10000 AS INTEGER)
   - (SELECT points FROM loyalty_transactions WHERE order_id=NEW.order_id),
   spend=spend-NEW.amount,
   orders=orders-CASE WHEN (SELECT SUM(amount) FROM pos_refunds WHERE order_id=NEW.order_id)=(SELECT total FROM qr_orders WHERE id=NEW.order_id) THEN 1 ELSE 0 END,
   updated_at=NEW.created_at
 WHERE id=(SELECT member_id FROM loyalty_transactions WHERE order_id=NEW.order_id);
 UPDATE loyalty_transactions SET
   amount=(SELECT total FROM qr_orders WHERE id=NEW.order_id)-(SELECT SUM(amount) FROM pos_refunds WHERE order_id=NEW.order_id),
   points=CAST(((SELECT total FROM qr_orders WHERE id=NEW.order_id)-(SELECT SUM(amount) FROM pos_refunds WHERE order_id=NEW.order_id))/10000 AS INTEGER)
 WHERE order_id=NEW.order_id;
 UPDATE members SET last_visit=(SELECT date(MAX(paid_at),'+7 hours') FROM loyalty_transactions
   WHERE member_id=members.id AND amount>0)
 WHERE id=(SELECT member_id FROM loyalty_transactions WHERE order_id=NEW.order_id);
END;
CREATE TABLE pos_refund_items (
 refund_id TEXT NOT NULL REFERENCES pos_refunds(id), product_id TEXT NOT NULL REFERENCES pos_product_inventory(product_id),
 qty INTEGER NOT NULL CHECK(qty>0), PRIMARY KEY(refund_id,product_id)
);
CREATE TRIGGER pos_refund_stock_guard BEFORE INSERT ON pos_refund_items BEGIN
 SELECT (CASE WHEN NEW.qty+COALESCE((SELECT SUM(x.qty) FROM pos_refund_items x JOIN pos_refunds r ON r.id=x.refund_id
   WHERE r.order_id=(SELECT order_id FROM pos_refunds WHERE id=NEW.refund_id) AND x.product_id=NEW.product_id),0)
   > COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)) FROM qr_orders o, json_each(o.items_json) j
     WHERE o.id=(SELECT order_id FROM pos_refunds WHERE id=NEW.refund_id) AND CAST(json_extract(j.value,'$.productId') AS TEXT)=NEW.product_id),0)
   THEN RAISE(ABORT,'REFUND_STOCK_EXCEEDS_SOLD') END);
 SELECT (CASE WHEN (SELECT bill_id FROM pos_refunds WHERE id=NEW.refund_id) IS NOT NULL AND
   NEW.qty+COALESCE((SELECT SUM(x.qty) FROM pos_refund_items x JOIN pos_refunds r ON r.id=x.refund_id
   WHERE r.bill_id=(SELECT bill_id FROM pos_refunds WHERE id=NEW.refund_id) AND x.product_id=NEW.product_id),0)
   > COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)) FROM pos_bills b,json_each(b.items_json) j
   WHERE b.id=(SELECT bill_id FROM pos_refunds WHERE id=NEW.refund_id) AND CAST(json_extract(j.value,'$.productId') AS TEXT)=NEW.product_id),0)
   THEN RAISE(ABORT,'REFUND_STOCK_EXCEEDS_SOLD') END);
END;
CREATE TRIGGER pos_refund_stock AFTER INSERT ON pos_refund_items BEGIN
 UPDATE pos_product_inventory SET stock=stock+NEW.qty WHERE product_id=NEW.product_id;
 UPDATE pos_ingredients SET stock=stock+NEW.qty*(SELECT qty FROM pos_recipes WHERE product_id=NEW.product_id AND ingredient_id=pos_ingredients.id)
 WHERE id IN (SELECT ingredient_id FROM pos_recipes WHERE product_id=NEW.product_id);
 INSERT INTO pos_inventory_movements(id,product_id,qty,kind,reference,actor_id,order_id,created_at)
 SELECT 'refund:'||NEW.refund_id||':product:'||NEW.product_id,NEW.product_id,NEW.qty,'REFUND_RESTOCK',r.reason,r.actor_id,r.order_id,r.created_at FROM pos_refunds r WHERE r.id=NEW.refund_id;
 INSERT INTO pos_inventory_movements(id,ingredient_id,qty,kind,reference,actor_id,order_id,created_at)
 SELECT 'refund:'||NEW.refund_id||':ingredient:'||r.ingredient_id,r.ingredient_id,NEW.qty*r.qty,'REFUND_RESTOCK',f.reason,f.actor_id,f.order_id,f.created_at
 FROM pos_refunds f JOIN pos_recipes r ON r.product_id=NEW.product_id WHERE f.id=NEW.refund_id;
END;
