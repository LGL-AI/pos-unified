-- One cloud pairing per till screen. Read access requires a separate random token.
-- No old POS tables or transactions are changed.
CREATE TABLE IF NOT EXISTS pos_display_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pos_display_expiry ON pos_display_sessions(expires_at);
