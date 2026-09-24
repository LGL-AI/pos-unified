-- ADDITIVE migration: existing orders remain intact. Never reset a deployed D1.
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  hash_iterations INTEGER NOT NULL DEFAULT 120000,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS member_sessions (
  jti TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_sessions_id ON member_sessions(member_id);
CREATE TABLE IF NOT EXISTS member_auth_limits (
  actor_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS vouchers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title_vi TEXT NOT NULL,
  title_zh TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('PERCENT','FIXED')),
  value INTEGER NOT NULL CHECK(value > 0),
  min_spend INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER NOT NULL DEFAULT 0,
  member_only INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  listed INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 0,
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK(reserved_count >= 0),
  redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK(redeemed_count >= 0),
  per_member_limit INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE qr_orders ADD COLUMN member_id TEXT;
ALTER TABLE qr_orders ADD COLUMN member_name TEXT;
ALTER TABLE qr_orders ADD COLUMN voucher_id TEXT;
ALTER TABLE qr_orders ADD COLUMN voucher_code TEXT;
ALTER TABLE qr_orders ADD COLUMN subtotal INTEGER;
ALTER TABLE qr_orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_qr_orders_member ON qr_orders(member_id,created_at DESC);
CREATE TABLE IF NOT EXISTS voucher_reservations (
  order_id TEXT PRIMARY KEY REFERENCES qr_orders(id),
  voucher_id TEXT NOT NULL REFERENCES vouchers(id),
  member_id TEXT,
  status TEXT NOT NULL DEFAULT 'HELD' CHECK(status IN ('HELD','REDEEMED','RELEASED')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voucher_member ON voucher_reservations(voucher_id, member_id, status);
-- SQLite's trigger and the order INSERT are one atomic statement. Retries with the
-- same idempotency key do not reserve a second voucher.
CREATE TRIGGER IF NOT EXISTS qr_voucher_guard BEFORE INSERT ON qr_orders
WHEN NEW.voucher_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM qr_orders WHERE idem_key=NEW.idem_key)
BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM vouchers v WHERE v.id=NEW.voucher_id AND v.active=1
      AND NEW.created_at >= v.starts_at AND NEW.created_at <= v.ends_at
      AND NEW.subtotal >= v.min_spend
      AND (v.member_only=0 OR NEW.member_id IS NOT NULL)
      AND (v.max_uses=0 OR v.reserved_count+v.redeemed_count < v.max_uses)
  ) THEN RAISE(ABORT,'VOUCHER_UNAVAILABLE') END);
  SELECT (CASE WHEN EXISTS (
    SELECT 1 FROM vouchers v WHERE v.id=NEW.voucher_id AND v.per_member_limit>0
      AND NEW.member_id IS NOT NULL AND
      (SELECT COUNT(*) FROM voucher_reservations r WHERE r.voucher_id=v.id
        AND r.member_id=NEW.member_id AND r.status IN ('HELD','REDEEMED')) >= v.per_member_limit
  ) THEN RAISE(ABORT,'VOUCHER_MEMBER_LIMIT') END);
END;
CREATE TRIGGER IF NOT EXISTS qr_voucher_reserve AFTER INSERT ON qr_orders
WHEN NEW.voucher_id IS NOT NULL
BEGIN
  UPDATE vouchers SET reserved_count=reserved_count+1 WHERE id=NEW.voucher_id;
  INSERT INTO voucher_reservations(order_id,voucher_id,member_id,status,created_at)
    VALUES(NEW.id,NEW.voucher_id,NEW.member_id,'HELD',NEW.created_at);
END;
-- Sample codes OFF by default. Owner must approve and enable them explicitly.
INSERT OR IGNORE INTO vouchers(id,code,title_vi,title_zh,kind,value,min_spend,max_discount,member_only,active,listed,starts_at,ends_at,max_uses,per_member_limit)
VALUES('sample-welcome10','WELCOME10','Ưu đãi thành viên mới 10%','新会员优惠九折','PERCENT',10,80000,30000,1,0,0,'2026-01-01T00:00:00.000Z','2027-12-31T23:59:59.999Z',100,1);
INSERT OR IGNORE INTO vouchers(id,code,title_vi,title_zh,kind,value,min_spend,max_discount,member_only,active,listed,starts_at,ends_at,max_uses,per_member_limit)
VALUES('sample-save20','SAVE20','Giảm 20.000đ cho đơn từ 150.000đ','满150,000越盾减20,000','FIXED',20000,150000,0,0,0,0,'2026-01-01T00:00:00.000Z','2027-12-31T23:59:59.999Z',200,0);

-- Remove obsolete kitchen authentication tables; kitchen endpoints are disabled.
DROP TABLE IF EXISTS kitchen_sessions;
DROP TABLE IF EXISTS kitchen_login_attempts;
