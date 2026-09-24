-- Additive POS integration. Keep the existing QR orders and member data.
ALTER TABLE qr_orders ADD COLUMN source TEXT NOT NULL DEFAULT 'QR';
ALTER TABLE qr_orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE qr_orders ADD COLUMN kitchen_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE qr_orders ADD COLUMN last_delta_json TEXT;
ALTER TABLE qr_orders ADD COLUMN last_change_kind TEXT;
ALTER TABLE qr_orders ADD COLUMN payment_method TEXT;
ALTER TABLE qr_orders ADD COLUMN cash_received INTEGER;
ALTER TABLE qr_orders ADD COLUMN cash_change INTEGER;
ALTER TABLE qr_orders ADD COLUMN bank_bin TEXT;
ALTER TABLE qr_orders ADD COLUMN bank_account TEXT;
ALTER TABLE qr_orders ADD COLUMN bank_name TEXT;

CREATE TABLE IF NOT EXISTS pos_staff_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pos_kitchen_jobs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES qr_orders(id),
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  items_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(order_id,revision)
);
CREATE INDEX IF NOT EXISTS idx_pos_kitchen_jobs ON pos_kitchen_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS pos_bills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES qr_orders(id),
  sequence INTEGER NOT NULL,
  items_json TEXT NOT NULL,
  subtotal INTEGER NOT NULL CHECK(subtotal >= 0),
  discount INTEGER NOT NULL CHECK(discount >= 0),
  total INTEGER NOT NULL CHECK(total >= 0),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  payment_method TEXT,
  cash_received INTEGER,
  cash_change INTEGER,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  UNIQUE(order_id,sequence)
);

-- All print jobs are created in the same D1 statement as the order transition.
CREATE TRIGGER IF NOT EXISTS pos_accept_qr AFTER UPDATE OF status ON qr_orders
WHEN OLD.status='NEW' AND NEW.status='ACCEPTED'
BEGIN
  INSERT INTO pos_kitchen_jobs(id,order_id,revision,kind,items_json,created_at,updated_at)
  VALUES('kitchen:'||NEW.id||':1',NEW.id,1,'NEW',NEW.items_json,NEW.updated_at,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS pos_create_staff AFTER INSERT ON qr_orders
WHEN NEW.source='POS' AND NEW.status='ACCEPTED'
BEGIN
  INSERT INTO pos_kitchen_jobs(id,order_id,revision,kind,items_json,created_at,updated_at)
  VALUES('kitchen:'||NEW.id||':1',NEW.id,1,'NEW',NEW.items_json,NEW.created_at,NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS pos_items_change AFTER UPDATE OF items_json ON qr_orders
WHEN NEW.kitchen_revision>OLD.kitchen_revision
BEGIN
  INSERT INTO pos_kitchen_jobs(id,order_id,revision,kind,items_json,created_at,updated_at)
  VALUES('kitchen:'||NEW.id||':'||NEW.kitchen_revision,NEW.id,NEW.kitchen_revision,
         NEW.last_change_kind,NEW.last_delta_json,NEW.updated_at,NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS pos_bill_guard BEFORE INSERT ON pos_bills
WHEN NOT EXISTS(SELECT 1 FROM qr_orders WHERE id=NEW.order_id
                 AND status='ACCEPTED' AND version=NEW.expected_version AND payment_status='UNPAID')
BEGIN SELECT RAISE(ABORT,'ORDER_CHANGED'); END;
CREATE TRIGGER IF NOT EXISTS pos_bill_paid AFTER UPDATE OF payment_status ON pos_bills
WHEN NEW.payment_status='PAID' AND OLD.payment_status='UNPAID'
BEGIN
  UPDATE qr_orders SET payment_status='PAID',status='PAID',paid_at=NEW.paid_at,updated_at=NEW.paid_at,
    version=version+1 WHERE id=NEW.order_id AND status='SPLIT'
    AND NOT EXISTS (SELECT 1 FROM pos_bills WHERE order_id=NEW.order_id AND payment_status!='PAID');
END;
CREATE TRIGGER IF NOT EXISTS pos_voucher_redeem AFTER UPDATE OF payment_status ON qr_orders
WHEN OLD.payment_status!='PAID' AND NEW.payment_status='PAID' AND NEW.voucher_id IS NOT NULL
BEGIN
  UPDATE vouchers SET reserved_count=reserved_count-1,redeemed_count=redeemed_count+1
  WHERE id=NEW.voucher_id AND EXISTS(SELECT 1 FROM voucher_reservations
    WHERE order_id=NEW.id AND status='HELD');
  UPDATE voucher_reservations SET status='REDEEMED' WHERE order_id=NEW.id AND status='HELD';
END;
CREATE TRIGGER IF NOT EXISTS pos_voucher_release AFTER UPDATE OF status ON qr_orders
WHEN NEW.status='CANCELLED' AND OLD.status!='CANCELLED' AND NEW.voucher_id IS NOT NULL
BEGIN
  UPDATE vouchers SET reserved_count=reserved_count-1
  WHERE id=NEW.voucher_id AND EXISTS(SELECT 1 FROM voucher_reservations
    WHERE order_id=NEW.id AND status='HELD');
  UPDATE voucher_reservations SET status='RELEASED' WHERE order_id=NEW.id AND status='HELD';
END;
