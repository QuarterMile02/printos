-- Ensure products has volume_discount_id and range_discount_id columns
-- referencing discounts(id). These were originally created in migration
-- 010_product_builder_FIXED.sql; this file is the idempotent guard so the
-- product-builder discount-assignment work can rely on the columns being
-- present in any environment, even one where 010 was applied incompletely.
--
-- ADD COLUMN IF NOT EXISTS is a no-op when the column already exists, so
-- this migration is safe to re-run. The FK is added in a separate guarded
-- block because Postgres has no IF NOT EXISTS on ADD CONSTRAINT.
--
-- Apply via the Supabase SQL editor.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS volume_discount_id uuid,
  ADD COLUMN IF NOT EXISTS range_discount_id  uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'products'
      AND constraint_name = 'products_volume_discount_id_fkey'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_volume_discount_id_fkey
      FOREIGN KEY (volume_discount_id) REFERENCES discounts(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'products'
      AND constraint_name = 'products_range_discount_id_fkey'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_range_discount_id_fkey
      FOREIGN KEY (range_discount_id) REFERENCES discounts(id);
  END IF;
END $$;
