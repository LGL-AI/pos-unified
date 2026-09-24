-- Durable customer orders. Do not reset this schema during a deploy.
CREATE TABLE IF NOT EXISTS qr_orders (
  id TEXT PRIMARY KEY,
  idem_key TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  table_id TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total INTEGER NOT NULL CHECK (total >= 0),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'NEW',
  payment_status TEXT NOT NULL DEFAULT 'UNPAID',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_qr_orders_recent ON qr_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qr_orders_status_recent ON qr_orders(status, created_at DESC);
CREATE TABLE IF NOT EXISTS kitchen_sessions (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kitchen_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS qr_order_rate (
 ip_hash TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 reset_at INTEGER NOT NULL
);
