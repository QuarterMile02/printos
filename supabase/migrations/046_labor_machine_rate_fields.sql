-- Migration 046: Add category, subcategory, material_category_ids, linked rate,
-- operator attendance, production prompts, cost calculator fields
-- to labor_rates and machine_rates tables

-- ── LABOR RATES ────────────────────────────────────────────────
ALTER TABLE labor_rates
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS material_category_ids uuid[],
  ADD COLUMN IF NOT EXISTS operator_attendance_percent numeric(5,2) DEFAULT 100,
  ADD COLUMN IF NOT EXISTS prod_rate_units text,
  ADD COLUMN IF NOT EXISTS pricing_table jsonb,
  ADD COLUMN IF NOT EXISTS production_rate_prompt text,
  ADD COLUMN IF NOT EXISTS production_rate_prompt_detail text,
  ADD COLUMN IF NOT EXISTS production_factor numeric(10,4),
  ADD COLUMN IF NOT EXISTS linked_machine_rate_id uuid REFERENCES machine_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cog_account text,
  ADD COLUMN IF NOT EXISTS volume_discount_id uuid REFERENCES discounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS per_li_unit boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS margin_width numeric(10,4),
  ADD COLUMN IF NOT EXISTS margin_height numeric(10,4),
  ADD COLUMN IF NOT EXISTS difficulty text;

-- ── MACHINE RATES ──────────────────────────────────────────────
ALTER TABLE machine_rates
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS material_category_ids uuid[],
  ADD COLUMN IF NOT EXISTS linked_labor_rate_id uuid REFERENCES labor_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS prod_rate_units text,
  ADD COLUMN IF NOT EXISTS pricing_table jsonb,
  ADD COLUMN IF NOT EXISTS production_mins_per_sqft numeric(10,4),
  ADD COLUMN IF NOT EXISTS margin_width numeric(10,4),
  ADD COLUMN IF NOT EXISTS margin_height numeric(10,4),
  ADD COLUMN IF NOT EXISTS difficulty text,
  ADD COLUMN IF NOT EXISTS volume_discount_id uuid REFERENCES discounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS per_li_unit boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cog_account text,
  -- Cost calculator inputs (UI only — calculated field, no formula stored)
  ADD COLUMN IF NOT EXISTS calc_equipment_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS calc_life_expectancy_years numeric(5,1),
  ADD COLUMN IF NOT EXISTS calc_days_per_year numeric(5,1),
  ADD COLUMN IF NOT EXISTS calc_hours_per_day numeric(5,1),
  ADD COLUMN IF NOT EXISTS calc_productivity_percent numeric(5,2);
