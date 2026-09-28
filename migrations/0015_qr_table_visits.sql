-- A QR opening records the table in D1 without storing visitor identifiers.
-- One row per table and local (Vietnam) day keeps this table bounded.
CREATE TABLE qr_table_visits (
 table_id TEXT NOT NULL CHECK(table_id GLOB 'T[0-9][0-9]'),
 visit_day TEXT NOT NULL,
 views INTEGER NOT NULL DEFAULT 0 CHECK(views >= 0),
 last_seen_at TEXT NOT NULL,
 PRIMARY KEY(table_id, visit_day)
);
CREATE INDEX idx_qr_table_visits_recent ON qr_table_visits(last_seen_at DESC);
