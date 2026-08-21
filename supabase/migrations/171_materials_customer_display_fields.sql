-- ============================================================
-- Migration 171: materials -- new fields for the material redesign,
-- Build 1 (schema only; the form itself is Build 2). Corresponds to
-- Build 1 instruction item 8.
-- Applied: PROPOSED, NOT run. Paste each statement below one at a time,
-- run its verification query immediately under it, then move on.
-- ============================================================
--
-- Numbered ahead of material_variants (172+) even though it was item 8
-- in the instructions, because material_variants' sqft/cost_per_unit/
-- sell_per_unit generated columns need materials.length_uom to already
-- exist -- see 173's header for why that column can't be added later
-- without breaking the dependency order Ruben pastes these in.
--
-- ================================================================
-- *** DO NOT PASTE STATEMENT 1 (the rename) UNTIL BUILD 2 SHIPS. ***
-- `external_name` is read/written in 24 files today (material-form.tsx,
-- actions-sr.ts, materials-list-client.tsx, material-card.tsx,
-- api/export/materials/route.ts, material-import-mapper.ts, and others
-- confirmed via a full-repo grep). Renaming the column before Build 2
-- updates those call sites breaks every one of them immediately --
-- material create/edit, the materials list, and the CSV export would
-- all start erroring on "column external_name does not exist". This
-- migration is written now because the schema work belongs in Build 1,
-- but the rename statement itself must be sequenced with Build 2's
-- code, not run today. Statements 2 onward (new additive columns) are
-- safe to run any time -- nothing reads them yet, so nothing breaks.
-- ================================================================

-- ------------------------------------------------------------
-- STATEMENT 1 of 9 -- HOLD until Build 2 ships (see warning above).
-- Rename external_name -> customer_display_name.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  RENAME COLUMN external_name TO customer_display_name;

-- Verification for statement 1:
--
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials'
--   and column_name in ('external_name', 'customer_display_name');
--
-- Expected: one row -- customer_display_name (external_name gone).

-- ------------------------------------------------------------
-- STATEMENT 2 of 9 -- safe any time.
-- customer_display_name_active: whether the customer-facing name
-- overrides the internal name on quotes/invoices/portal, same on/off
-- pattern as description_active below -- both let Ruben fill in a
-- custom-facing value without it going live until he flips the switch.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS customer_display_name_active boolean NOT NULL DEFAULT false;

-- Verification:
-- select column_name, data_type, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'customer_display_name_active';
-- Expected: customer_display_name_active | boolean | false

-- ------------------------------------------------------------
-- STATEMENT 3 of 9 -- safe any time.
-- description_active: same pattern, for the existing `description` column.
-- ------------------------------------------------------------
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS description_active boolean NOT NULL DEFAULT false;

-- Verification:
-- select column_name, data_type, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'materials' and column_name = 'description_active';
-- Expected: description_active | boolean | false

-- ------------------------------------------------------------
-- STATEMENT 4 of 9 -- safe any time, but run BEFORE 173 (material_variants)
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
-- STATEMENT 5 of 9 -- safe any time.
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
-- STATEMENT 6 of 9 -- safe any time.
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
-- STATEMENT 7 of 9 -- safe any time.
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
-- STATEMENT 8 of 9 -- safe any time.
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
-- STATEMENT 9 of 9 -- safe any time.
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
