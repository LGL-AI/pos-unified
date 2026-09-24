-- POS offline accrual rule: one point for every 10,000 VND of the final paid total.
-- Keep existing member points; award new cloud orders only after POS confirms payment.
ALTER TABLE members ADD COLUMN spend INTEGER NOT NULL DEFAULT 0 CHECK(spend >= 0);
ALTER TABLE members ADD COLUMN orders INTEGER NOT NULL DEFAULT 0 CHECK(orders >= 0);
ALTER TABLE members ADD COLUMN last_visit TEXT;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  order_id TEXT PRIMARY KEY REFERENCES qr_orders(id),
  order_code TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id),
  amount INTEGER NOT NULL CHECK(amount >= 0),
  points INTEGER NOT NULL CHECK(points >= 0),
  paid_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_loyalty_member_recent ON loyalty_transactions(member_id,paid_at DESC);

-- A split order reaches PAID once, after its final bill; no points on a transfer report.
-- Both ledger entry and balance update belong to the same atomic payment statement.
CREATE TRIGGER IF NOT EXISTS pos_loyalty_paid AFTER UPDATE OF payment_status ON qr_orders
WHEN OLD.payment_status!='PAID' AND NEW.payment_status='PAID' AND NEW.member_id IS NOT NULL
BEGIN
  INSERT INTO loyalty_transactions(order_id,order_code,member_id,amount,points,paid_at)
  VALUES(NEW.id,NEW.code,NEW.member_id,NEW.total,CAST(NEW.total / 10000 AS INTEGER),COALESCE(NEW.paid_at,NEW.updated_at));
  UPDATE members SET
    points=points+CAST(NEW.total / 10000 AS INTEGER),
    spend=spend+NEW.total,
    orders=orders+1,
    last_visit=date(COALESCE(NEW.paid_at,NEW.updated_at),'+7 hours'),
    updated_at=COALESCE(NEW.paid_at,NEW.updated_at)
  WHERE id=NEW.member_id;
END;
