-- 036 — Rate category metadata for the product builder redesign
--
-- Adds the columns the product builder needs to drive its "Add by Category"
-- workflow: subcategory + material category linkage + production-rate units
-- + an optional thickness-based complexity pricing table.
--
-- `category` already exists on both tables (added in migration 034) but is
-- re-added here with IF NOT EXISTS so this migration is safe to re-run on
-- environments where 034 may not have been applied.
--
-- category vocabulary (text, no enum so customers can extend):
--   'Large Format Printing', 'Cutting', 'Routing', 'Laminating',
--   'Finishing', 'Assembly', 'Installation', 'Design', 'Other'
--
-- pricing_table jsonb shape (optional, for cutting/routing rates):
--   [{ "thickness_min": number, "thickness_max": number,
--      "simple_rate": number, "moderate_rate": number, "complex_rate": number }, ...]

-- ---------- labor_rates ----------
ALTER TABLE labor_rates
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS material_category_ids uuid[],
  ADD COLUMN IF NOT EXISTS operator_attendance_percent numeric(5,2) DEFAULT 100,
  ADD COLUMN IF NOT EXISTS prod_rate_units text,
  ADD COLUMN IF NOT EXISTS pricing_table jsonb;

CREATE INDEX IF NOT EXISTS labor_rates_material_category_ids_idx
  ON labor_rates USING GIN (material_category_ids);

-- ---------- machine_rates ----------
ALTER TABLE machine_rates
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS material_category_ids uuid[],
  ADD COLUMN IF NOT EXISTS linked_labor_rate_id uuid
    REFERENCES labor_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_mins_per_sqft numeric(8,4),
  ADD COLUMN IF NOT EXISTS prod_rate_units text,
  ADD COLUMN IF NOT EXISTS pricing_table jsonb;

CREATE INDEX IF NOT EXISTS machine_rates_material_category_ids_idx
  ON machine_rates USING GIN (material_category_ids);

CREATE INDEX IF NOT EXISTS machine_rates_linked_labor_rate_id_idx
  ON machine_rates (linked_labor_rate_id);
