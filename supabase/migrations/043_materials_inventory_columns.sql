-- Migration 043: inventory tracking columns on materials table
-- Applied 2026-05-02 via Supabase SQL editor.

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS current_stock            numeric(12,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock_level          numeric(12,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_quantity         numeric(12,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_inventory_count_at  timestamptz;

-- Backfill NULL values on existing rows (DEFAULT only applies to future inserts).
UPDATE materials SET current_stock   = 0 WHERE current_stock   IS NULL;
UPDATE materials SET min_stock_level = 0 WHERE min_stock_level IS NULL;
UPDATE materials SET reorder_quantity = 0 WHERE reorder_quantity IS NULL;

-- Partial index for the low-stock query pattern.
CREATE INDEX IF NOT EXISTS idx_materials_low_stock
  ON materials(organization_id, active)
  WHERE current_stock < min_stock_level;
