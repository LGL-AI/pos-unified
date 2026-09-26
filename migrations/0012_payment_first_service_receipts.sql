-- Additive release: kitchen work begins only after confirmed payment.
-- Legacy slips already printed cannot be recalled. Unsent slips on unpaid orders
-- are voided so they cannot be claimed by an old counter or handheld session.
CREATE TABLE pos_order_daily_sequence (
 business_day TEXT PRIMARY KEY,
 next_sequence INTEGER NOT NULL CHECK(next_sequence>0)
);
CREATE TABLE pos_service_requests (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL REFERENCES qr_orders(id),
 table_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACKNOWLEDGED')),
 created_at TEXT NOT NULL,
 acknowledged_at TEXT,
 acknowledged_by TEXT
);
CREATE INDEX idx_service_pending ON pos_service_requests(status,created_at);
CREATE UNIQUE INDEX idx_service_one_pending ON pos_service_requests(order_id) WHERE status='PENDING';
ALTER TABLE pos_store_config ADD COLUMN feedback_url TEXT NOT NULL DEFAULT '';
ALTER TABLE pos_store_config ADD COLUMN invoice_url TEXT NOT NULL DEFAULT '';

-- Separate the returned/compensated product from stock restocking. Older
-- refunds have no per-product detail, and must remain labeled unknown.
CREATE TABLE pos_refund_line_items (
 refund_id TEXT NOT NULL REFERENCES pos_refunds(id),
 product_id TEXT NOT NULL,
 product_name TEXT NOT NULL,
 qty INTEGER NOT NULL CHECK(qty>0),
 amount INTEGER NOT NULL CHECK(amount>=0),
 category TEXT NOT NULL CHECK(category IN ('RETURNED','COMPENSATED')),
 PRIMARY KEY(refund_id,product_id,category)
);
CREATE TRIGGER pos_refund_line_qty_guard BEFORE INSERT ON pos_refund_line_items BEGIN
 SELECT CASE WHEN NEW.qty +
  COALESCE((SELECT SUM(l.qty) FROM pos_refund_line_items l
   JOIN pos_refunds previous ON previous.id=l.refund_id
   JOIN pos_refunds current ON current.id=NEW.refund_id
   WHERE previous.order_id=current.order_id
    AND COALESCE(previous.bill_id,'')=COALESCE(current.bill_id,'')
    AND l.product_id=NEW.product_id),0) >
  COALESCE((SELECT SUM(CAST(json_extract(j.value,'$.qty') AS INTEGER))
   FROM pos_refunds current,
   json_each(COALESCE((SELECT b.items_json FROM pos_bills b WHERE b.id=current.bill_id),
     (SELECT o.items_json FROM qr_orders o WHERE o.id=current.order_id))) j
   WHERE current.id=NEW.refund_id AND CAST(json_extract(j.value,'$.productId') AS TEXT)=NEW.product_id),0)
 THEN RAISE(ABORT,'REFUND_ITEM_EXCEEDS_SOLD') END;
END;

DROP TRIGGER IF EXISTS pos_accept_qr;
DROP TRIGGER IF EXISTS pos_create_staff;
DROP TRIGGER IF EXISTS pos_items_change;
UPDATE pos_kitchen_jobs SET status='VOID',updated_at=datetime('now')
 WHERE status IN ('PENDING','FAILED','CLAIMED')
 AND EXISTS (SELECT 1 FROM qr_orders o WHERE o.id=pos_kitchen_jobs.order_id AND o.payment_status!='PAID');
CREATE TRIGGER pos_kitchen_after_payment AFTER UPDATE OF payment_status ON qr_orders
WHEN NEW.payment_status='PAID' AND OLD.payment_status!='PAID'
 AND NOT EXISTS(SELECT 1 FROM pos_kitchen_jobs j WHERE j.order_id=NEW.id AND j.status IN ('SENT','CONFIRMED','UNKNOWN'))
BEGIN
 INSERT INTO pos_kitchen_jobs(id,order_id,revision,kind,items_json,created_at,updated_at)
 SELECT 'kitchen:'||NEW.id||':'||(COALESCE(MAX(revision),0)+1),NEW.id,
        COALESCE(MAX(revision),0)+1,'NEW',NEW.items_json,NEW.paid_at,NEW.paid_at
 FROM pos_kitchen_jobs WHERE order_id=NEW.id;
END;
