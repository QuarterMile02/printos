-- 033 — Extra fields on product_default_items
-- Added for the redesigned product migration builder
-- workflow_step: when true, this row appears as a production step on the job board
-- modifier_formula: custom expression like "((A)+(B))" that overrides the simple modifier lookup
-- wastage_percent: material wastage override per product (e.g. 11.11 for banners)
-- item_markup: markup override per product (defaults to the material's own multiplier)

ALTER TABLE product_default_items ADD COLUMN IF NOT EXISTS workflow_step boolean DEFAULT false;
ALTER TABLE product_default_items ADD COLUMN IF NOT EXISTS modifier_formula text;
ALTER TABLE product_default_items ADD COLUMN IF NOT EXISTS wastage_percent numeric DEFAULT 0;
ALTER TABLE product_default_items ADD COLUMN IF NOT EXISTS item_markup numeric DEFAULT 1;
