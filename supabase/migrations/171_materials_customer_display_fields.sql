-- ============================================================
-- Migration 171: materials -- new fields for the material redesign,
-- Build 1 (schema only; the form itself is Build 2). Corresponds to
-- Build 1 instruction item 8.
-- Applied: PROPOSED, NOT run. Paste each statement below one at a time,
-- run its verification query immediately under it, then move on.
-- ============================================================
--
-- Numbered ahead of material_variants (173+) even though it was item 8
-- in the instructions, because material_variants' sqft/cost_per_unit/
-- sell_per_unit generated columns need materials.length_uom to already
-- exist -- see 173's header for why that column can't be added later
-- without breaking the dependency order Ruben pastes these in.
--
-- The customer_display_name rename (external_name -> customer_display_
-- name) has been SPLIT OUT of this file into its own migration,
-- 180_materials_rename_external_name_HOLD_FOR_BUILD2.sql, numbered
-- after 179 specifically so it can never sort or get bundled together
-- with the safe additive columns below -- it must not run until Build 2
-- updates the 24 files that still read external_name today. Everything
-- in THIS file is safe to run any time, independent of that rename.

-- ------------------------------------------------------------
-- STATEMENT 1 of 8 -- safe any time.
-- customer_display_name_active: whether the customer-facing name
-- overrides the internal name on quotes/invoices/portal, same on/off
-- pattern as description_active below -- both let Ruben fill in a
-- custom-facing value without it going live until he flips the switch.
-- Named "customer_display_name_active" now, ahead of the column it
-- gates (customer_display_name) actually existing -- that's fine, this
-- is just a boolean flag with no FK/dependency on the rename.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS customer_display_name_active boolean NOT NULL DEFAULT false;

-- Verification:
-- select column_name, data_type, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'customer_display_name_active';
-- Expected: customer_display_name_active | boolean | false

-- ------------------------------------------------------------
-- STATEMENT 2 of 8 -- safe any time.
-- description_active: same pattern, for the existing `description` column.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS description_active boolean NOT NULL DEFAULT false;

-- Verification:
-- select column_name, data_type, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'description_active';
-- Expected: description_active | boolean | false

-- ------------------------------------------------------------
-- STATEMENT 3 of 8 -- safe any time, but run BEFORE 173 (material_variants)
-- since that migration's generated columns depend on this existing.
-- length_uom: drives Roll/Substrate/Unit dimension-to-sqft conversion
-- on material_variants. Defaulted to 'in' (sheets/substrates, the
-- majority case per Finding A -- 235/235 Rigid Substrates- Sheets rows
-- use inch dimensions) rather than left NULL, so every existing and new
-- variant has a defined conversion from day one.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS length_uom text NOT NULL DEFAULT 'in'
    CHECK (length_uom IN ('in', 'ft', 'yd'));

-- Verification:
-- select column_name, data_type, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'length_uom';
-- Expected: length_uom | text | 'in'::text

-- ------------------------------------------------------------
-- STATEMENT 4 of 8 -- safe any time.
-- weight_divide_by: divisor applied to `weight` to get a per-unit
-- figure (e.g. weight of a full roll / weight_divide_by = weight per
-- linear ft). No existing column covers this -- new, numeric, nullable
-- (NULL = not applicable, same convention as shelf_life_months below).
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS weight_divide_by numeric(12,4);

-- Verification:
-- select column_name, data_type, numeric_precision, numeric_scale from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'weight_divide_by';
-- Expected: weight_divide_by | numeric | 12 | 4

-- ------------------------------------------------------------
-- STATEMENT 5 of 8 -- safe any time.
-- shelf_life_months: integer (whole months), NULL = Not Applicable per
-- explicit instruction -- no default, no CHECK forcing a value.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS shelf_life_months integer;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'shelf_life_months';
-- Expected: shelf_life_months | integer

-- ------------------------------------------------------------
-- STATEMENT 6 of 8 -- safe any time.
-- shelf_clock_from: what event starts the shelf-life clock. No domain
-- was specified in the spec -- ASSUMPTION, flagging explicitly: kept as
-- free text rather than a CHECK-constrained enum, since the real set of
-- values (e.g. 'received' / 'manufactured' / 'invoiced') wasn't given.
-- Build 2's form can constrain the input with a <select> without a DB
-- CHECK forcing it prematurely. Revisit if Ruben wants it enum-locked.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS shelf_clock_from text;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'shelf_clock_from';
-- Expected: shelf_clock_from | text

-- ------------------------------------------------------------
-- STATEMENT 7 of 8 -- safe any time.
-- expiry_warn_at: ASSUMPTION -- stored as integer days-before-expiry to
-- trigger a warning (e.g. 30 = warn 30 days before shelf_life_months'
-- expiry date). Spec didn't give units; days chosen since shelf life
-- itself is in months and a sub-month warn window needs a finer unit.
-- Flagging for Ruben to correct if a different unit/meaning was meant.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS expiry_warn_at integer;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'expiry_warn_at';
-- Expected: expiry_warn_at | integer

-- ------------------------------------------------------------
-- STATEMENT 8 of 8 -- safe any time.
-- price_band: ASSUMPTION -- free text label (e.g. an internal
-- price-tier code) rather than an FK, since no price-band settings
-- table exists yet and none was asked for in this build. If Ruben wants
-- a governed list of bands later, this becomes an FK migration then.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS price_band text;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'price_band';
-- Expected: price_band | text
