-- 034 — Rate categories + product option rates
-- labor_rates.category and machine_rates.category drive the new "Add by Category"
-- selector on the product migration builder. Material categories already live in
-- the material_categories table and need no change here.
--
-- product_option_rates stores the rates a sales rep can choose from at quote time
-- for a given product — distinct from product_default_items (fixed recipe).

ALTER TABLE labor_rates   ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE machine_rates ADD COLUMN IF NOT EXISTS category text;

CREATE TABLE IF NOT EXISTS product_option_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rate_type text NOT NULL CHECK (rate_type IN ('labor_rate', 'machine_rate')),
  rate_id uuid NOT NULL,
  category text,
  formula text DEFAULT 'Area',
  multiplier numeric DEFAULT 1,
  charge_per_li_unit boolean DEFAULT false,
  modifier_formula text,
  workflow_step boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(product_id, rate_type, rate_id)
);

CREATE INDEX IF NOT EXISTS product_option_rates_product_idx
  ON product_option_rates(product_id, sort_order);
