-- 032 — Product migration tracking fields (ShopVOX → PrintOS)
-- migration_status: 'shopvox_reference' | 'in_progress' | 'printos_ready'
-- shopvox_data: full ShopVOX extraction as JSON for read-only reference

ALTER TABLE products ADD COLUMN IF NOT EXISTS migration_status text DEFAULT 'shopvox_reference';
ALTER TABLE products ADD COLUMN IF NOT EXISTS shopvox_data jsonb;

CREATE INDEX IF NOT EXISTS products_migration_status_idx ON products(organization_id, migration_status);
