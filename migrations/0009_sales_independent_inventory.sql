-- 0009: orders never fail because of physical or estimated stock. Keep the
-- physical count entered by staff; track signed, approximate usage separately.
-- STEP 01
CREATE TABLE IF NOT EXISTS pos_inventory_estimates (
 target TEXT NOT NULL CHECK(target IN ('PRODUCT','INGREDIENT')),
 ref_id TEXT NOT NULL,
 estimated_stock INTEGER NOT NULL,
 PRIMARY KEY(target,ref_id)
);
-- STEP 02
INSERT OR IGNORE INTO pos_inventory_estimates(target,ref_id,estimated_stock)
 SELECT 'PRODUCT',product_id,stock FROM pos_product_inventory;
-- STEP 03
INSERT OR IGNORE INTO pos_inventory_estimates(target,ref_id,estimated_stock)
 SELECT 'INGREDIENT',id,stock FROM pos_ingredients;
-- STEP 04
CREATE TRIGGER IF NOT EXISTS pos_estimate_new_product AFTER INSERT ON pos_product_inventory BEGIN
 INSERT OR IGNORE INTO pos_inventory_estimates(target,ref_id,estimated_stock) VALUES('PRODUCT',NEW.product_id,NEW.stock);
END;
-- STEP 05
CREATE TRIGGER IF NOT EXISTS pos_estimate_new_ingredient AFTER INSERT ON pos_ingredients BEGIN
 INSERT OR IGNORE INTO pos_inventory_estimates(target,ref_id,estimated_stock) VALUES('INGREDIENT',NEW.id,NEW.stock);
END;
-- STEP 06
CREATE TRIGGER IF NOT EXISTS pos_estimate_product_stock_sync AFTER UPDATE OF stock ON pos_product_inventory BEGIN
 UPDATE pos_inventory_estimates SET estimated_stock=estimated_stock+(NEW.stock-OLD.stock)
 WHERE target='PRODUCT' AND ref_id=NEW.product_id;
END;
-- STEP 07
CREATE TRIGGER IF NOT EXISTS pos_estimate_ingredient_stock_sync AFTER UPDATE OF stock ON pos_ingredients BEGIN
 UPDATE pos_inventory_estimates SET estimated_stock=estimated_stock+(NEW.stock-OLD.stock)
 WHERE target='INGREDIENT' AND ref_id=NEW.id;
END;
-- Include any stock records created while the helper triggers were being installed.
-- STEP 08
INSERT OR IGNORE INTO pos_inventory_estimates(target,ref_id,estimated_stock)
 SELECT 'PRODUCT',product_id,stock FROM pos_product_inventory;
-- STEP 09
INSERT OR IGNORE INTO pos_inventory_estimates(target,ref_id,estimated_stock)
 SELECT 'INGREDIENT',id,stock FROM pos_ingredients;
-- Rebase only while BOTH legacy order triggers still exist. The migration
-- runner skips these two steps if it is resuming after the first legacy DROP.
-- STEP 10
UPDATE pos_inventory_estimates SET estimated_stock=(
 SELECT stock FROM pos_product_inventory WHERE product_id=ref_id)
WHERE target='PRODUCT';
-- STEP 11
UPDATE pos_inventory_estimates SET estimated_stock=(
 SELECT stock FROM pos_ingredients WHERE id=ref_id)
WHERE target='INGREDIENT';
-- Install replacement triggers before dropping the legacy blocking triggers.
-- STEP 12
CREATE TRIGGER IF NOT EXISTS pos_stock_new_v9 AFTER INSERT ON qr_orders
WHEN NEW.inventory_tracked=1 AND NOT EXISTS(
 SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='pos_stock_new') BEGIN
 UPDATE pos_inventory_estimates SET estimated_stock=estimated_stock-
   (SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(NEW.items_json)
    WHERE CAST(json_extract(value,'$.productId') AS TEXT)=ref_id)
 WHERE target='PRODUCT' AND ref_id IN (
   SELECT CAST(json_extract(value,'$.productId') AS TEXT) FROM json_each(NEW.items_json));
 UPDATE pos_inventory_estimates SET estimated_stock=estimated_stock-
   (SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty)
    FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT)
    WHERE r.ingredient_id=ref_id)
 WHERE target='INGREDIENT' AND ref_id IN (
   SELECT r.ingredient_id FROM json_each(NEW.items_json) j JOIN pos_recipes r
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
-- STEP 13
CREATE TRIGGER IF NOT EXISTS pos_stock_change_v9 AFTER UPDATE OF items_json ON qr_orders
WHEN NEW.kitchen_revision>OLD.kitchen_revision AND (NEW.inventory_tracked=1 OR OLD.inventory_tracked=1)
 AND NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger' AND name='pos_stock_change')
BEGIN
 UPDATE pos_inventory_estimates SET estimated_stock=estimated_stock
   + CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(OLD.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=ref_id),0) ELSE 0 END
   - CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(value,'$.qty') AS INTEGER)) FROM json_each(NEW.items_json) WHERE CAST(json_extract(value,'$.productId') AS TEXT)=ref_id),0) ELSE 0 END
 WHERE target='PRODUCT';
 UPDATE pos_inventory_estimates SET estimated_stock=estimated_stock
   + CASE WHEN OLD.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(OLD.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=ref_id),0) ELSE 0 END
   - CASE WHEN NEW.inventory_tracked=1 THEN COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER)*r.qty) FROM json_each(NEW.items_json) j JOIN pos_recipes r ON r.product_id=CAST(json_extract(j.value,'$.productId') AS TEXT) WHERE r.ingredient_id=ref_id),0) ELSE 0 END
 WHERE target='INGREDIENT';
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
-- STEP 14
DROP TRIGGER IF EXISTS pos_stock_new;
-- STEP 15
DROP TRIGGER IF EXISTS pos_stock_change;
