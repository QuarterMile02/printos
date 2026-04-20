-- 035 — Add include_in_base_price to product_option_rates
-- The migration builder exposes a "Base" checkbox on each rate row meaning
-- the rate is charged in the base price before modifiers are applied.

ALTER TABLE product_option_rates
  ADD COLUMN IF NOT EXISTS include_in_base_price boolean DEFAULT false;
