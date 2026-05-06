-- Migration 047: additional materials fields for the redesigned edit page.
--
-- Many of the columns referenced by the new form already exist in
-- 010_product_builder_FIXED.sql. The ADD COLUMN IF NOT EXISTS blocks below
-- are safe to re-run; they will only add columns that are genuinely missing.
--
-- Genuinely new columns:
--   material_type, material_category   text-based replacements for the FK
--                                      columns (material_type_id, category_id)
--   unit_width, unit_height, unit_cost  package/sheet dimensions and cost
--   cog_account                         distinct from existing cog_account_name
--   display_description_in_li           boolean (existing
--                                       display_name_in_line_item is text)

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS material_type text,
  ADD COLUMN IF NOT EXISTS material_category text,
  ADD COLUMN IF NOT EXISTS unit_width numeric(10,4),
  ADD COLUMN IF NOT EXISTS unit_height numeric(10,4),
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,4),
  ADD COLUMN IF NOT EXISTS other_charge numeric(12,4),
  ADD COLUMN IF NOT EXISTS per_li_unit boolean,
  ADD COLUMN IF NOT EXISTS calculate_wastage boolean,
  ADD COLUMN IF NOT EXISTS include_in_base_price boolean,
  ADD COLUMN IF NOT EXISTS discount_id uuid,
  ADD COLUMN IF NOT EXISTS part_number text,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS weight numeric(10,4),
  ADD COLUMN IF NOT EXISTS weight_uom text,
  ADD COLUMN IF NOT EXISTS cog_account text,
  ADD COLUMN IF NOT EXISTS qb_item_type text,
  ADD COLUMN IF NOT EXISTS po_description text,
  ADD COLUMN IF NOT EXISTS info_url text,
  ADD COLUMN IF NOT EXISTS print_image_on_pdf boolean,
  ADD COLUMN IF NOT EXISTS show_internal boolean,
  ADD COLUMN IF NOT EXISTS external_name text,
  ADD COLUMN IF NOT EXISTS display_description_in_li boolean,
  ADD COLUMN IF NOT EXISTS description text;

-- FK constraint for discount_id, only added when missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'materials_discount_id_fkey'
  ) THEN
    ALTER TABLE materials
      ADD CONSTRAINT materials_discount_id_fkey
      FOREIGN KEY (discount_id) REFERENCES discounts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Index for the new Type filter on the materials list page.
CREATE INDEX IF NOT EXISTS idx_materials_org_type
  ON materials(organization_id, material_type)
  WHERE material_type IS NOT NULL;
