-- Customer management extends the existing member ledger; all older members remain.
ALTER TABLE members ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN birthday TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN tier_override TEXT NOT NULL DEFAULT '' CHECK(tier_override IN ('','Member','Silver','Gold','Platinum'));
ALTER TABLE members ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_members_recent ON members(updated_at DESC);
UPDATE pos_roles SET permissions_json=json_insert(permissions_json,'$[#]','CUSTOMER_MANAGE')
 WHERE id IN ('OWNER','MANAGER')
 AND NOT EXISTS(SELECT 1 FROM json_each(pos_roles.permissions_json) WHERE value='CUSTOMER_MANAGE');
-- Poll only slips made after this upgrade; older paid orders must not print again.
CREATE TABLE pos_auto_print_config (id INTEGER PRIMARY KEY CHECK(id=1), since_at TEXT NOT NULL);
INSERT INTO pos_auto_print_config(id,since_at) VALUES(1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
