-- Single-store, owner-managed settings. Financial data on orders remains a snapshot.
CREATE TABLE pos_store_config (
 id INTEGER PRIMARY KEY CHECK(id=1),
 store_name TEXT NOT NULL, store_name_cn TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', tax_number TEXT NOT NULL DEFAULT '',
 table_count INTEGER NOT NULL DEFAULT 99 CHECK(table_count BETWEEN 1 AND 99),
 logo_png TEXT NOT NULL DEFAULT '',
 bank_label TEXT NOT NULL DEFAULT '',bank_bin TEXT NOT NULL DEFAULT '', bank_account TEXT NOT NULL DEFAULT '', bank_name TEXT NOT NULL DEFAULT '',
 transfer_prefix TEXT NOT NULL DEFAULT 'PT',
 tax_mode TEXT NOT NULL DEFAULT 'INCLUSIVE' CHECK(tax_mode IN ('INCLUSIVE','EXCLUSIVE')),
 tax_rate INTEGER NOT NULL DEFAULT 0 CHECK(tax_rate BETWEEN 0 AND 3000),
 github_url TEXT NOT NULL DEFAULT 'https://github.com/LGL-AI/pos-unified',
 updated_by TEXT NOT NULL DEFAULT 'system',updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO pos_store_config(id,store_name,store_name_cn,table_count,bank_label,bank_bin,bank_account,bank_name,updated_at)
 VALUES(1,'TIỆM SÍU LẬP PHÁT TÀI','發財燒臘',99,'OCB','970448','609271','HUANG TIANSHENG','2026-09-24T00:00:00.000Z');
ALTER TABLE qr_orders ADD COLUMN bank_label TEXT NOT NULL DEFAULT '';
ALTER TABLE qr_orders ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'INCLUSIVE';
ALTER TABLE qr_orders ADD COLUMN tax_rate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE qr_orders ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE qr_orders ADD COLUMN transfer_prefix TEXT NOT NULL DEFAULT 'PT';
ALTER TABLE pos_bills ADD COLUMN tax_amount INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_qr_orders_paid_day ON qr_orders(payment_status,paid_at);
CREATE INDEX idx_pos_bills_paid_day ON pos_bills(payment_status,paid_at);
