-- ============================================================
-- Migration 175: material_vendors -- ADD routing/PO fields. Build 1 item 3.
-- Applied: PROPOSED, NOT run. Requires 172 (delivery_methods) first.
-- ============================================================
--
-- info_url is NOT added here -- material_vendors.info_url already
-- exists (migration 123) and is confirmed 100%% empty (0/893 rows,
-- Finding C). That is where materials.info_url maps once Build 2 moves
-- it. No new url column.
--
-- ---- is_preferred vs. the (material_id, vendor_name) duplicate finding ----
-- Investigated before writing this constraint, per instruction.
-- Confirmed live: 54 (material_id, vendor_name) pairs have more than one
-- row -- e.g. material f4238c83.../"Grimco" has a rank-2 row at $40.56
-- and a rank-3 row at $163.27. All 54 groups are 100%% active=true on
-- every row (checked explicitly) -- these are not stale duplicates or
-- an active/inactive pair, they are genuinely different price points
-- for the same vendor (different quantity/rank tiers), confirming
-- migration 123's own note about "Grimco" appearing twice.
--
-- This turns out NOT to complicate "at most one is_preferred per
-- material": the constraint is scoped to material_id alone, not to
-- (material_id, vendor_name) -- so it already prevents two rows of the
-- SAME vendor from both being marked preferred (they'd both be rows for
-- that one material_id), not just two different vendors. A partial
-- unique index on material_id WHERE is_preferred is therefore both
-- correct and sufficient with no extra logic needed. The practical
-- consequence for Build 2's UI: Ruben isn't picking "a preferred
-- vendor", he's picking one specific price ROW as preferred (e.g. the
-- rank-1/lowest row) -- meaningful given a vendor can have several rows
-- at different price points, and the routing needs exactly one.

-- ------------------------------------------------------------
-- STATEMENT 1 of 8 -- is_preferred column.
-- ------------------------------------------------------------
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS is_preferred boolean NOT NULL DEFAULT false;

-- Verification:
-- select column_name, data_type, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'is_preferred';
-- Expected: is_preferred | boolean | false

-- ------------------------------------------------------------
-- STATEMENT 2 of 8 -- at most one is_preferred=true row per material.
-- Safe given the finding above: it's a materials-wide constraint, not
-- vendor-scoped, so the 54 same-vendor duplicate groups don't conflict
-- with it -- they just mean "pick which one row", same as any other
-- vendor's multiple rows would require.
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_vendors_one_preferred
  ON public.material_vendors(material_id) WHERE is_preferred;

-- Verification:
-- select indexname from pg_indexes where tablename = 'material_vendors' and indexname = 'idx_material_vendors_one_preferred';
-- Expected: one row.

-- ------------------------------------------------------------
-- STATEMENT 3 of 8 -- vendor_part_number. Distinct from the existing
-- `part_number` column (ShopVOX's own Vendor Price grid "Part Number"
-- field, already populated 323/893) -- this new one is where materials.
-- part_number (the material-level field, moving off the materials form
-- per item 8) lands once Build 2 does that move. Kept separate rather
-- than reusing `part_number` since the two can legitimately differ
-- (ShopVOX's scraped vendor part # vs. Ruben's material-level part #).
-- ------------------------------------------------------------
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS vendor_part_number text;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'vendor_part_number';
-- Expected: vendor_part_number | text

-- ------------------------------------------------------------
-- STATEMENT 4 of 8 -- sku. materials.sku moves here per item 8.
-- ------------------------------------------------------------
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS sku text;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'sku';
-- Expected: sku | text

-- ------------------------------------------------------------
-- STATEMENT 5 of 8 -- delivery_method_id FK -> delivery_methods (172).
-- ON DELETE SET NULL: deleting a delivery method setting shouldn't
-- cascade-delete real vendor pricing rows.
-- ------------------------------------------------------------
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS delivery_method_id uuid REFERENCES public.delivery_methods(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_material_vendors_delivery_method ON public.material_vendors(delivery_method_id);

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'delivery_method_id';
-- Expected: delivery_method_id | uuid
-- select conname from pg_constraint where conrelid = 'public.material_vendors'::regclass and contype = 'f' and conname like '%delivery_method%';
-- Expected: one row.

-- ------------------------------------------------------------
-- STATEMENT 6 of 8 -- delivery_days: which days of the week this
-- vendor delivers, only meaningful when the chosen delivery_method has
-- is_scheduled = true (Build 2 form concern, not enforced here).
-- text[] rather than a CHECK-constrained set since day names/format
-- (Mon/Tue vs full names) wasn't specified -- Build 2's form picks the
-- exact values it writes.
-- ------------------------------------------------------------
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS delivery_days text[];

-- Verification:
-- select column_name, data_type, udt_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_vendors' and column_name = 'delivery_days';
-- Expected: delivery_days | ARRAY | _text

-- ------------------------------------------------------------
-- STATEMENT 7 of 8 -- lead_time_days: only meaningful when the chosen
-- delivery_method has is_scheduled = false (greyed out otherwise, per
-- item 5's stated behavior -- Build 2 form concern).
-- ------------------------------------------------------------
ALTER TABLE public.material_vendors
  ADD COLUMN IF NOT EXISTS lead_time_days integer,
  ADD COLUMN IF NOT EXISTS free_delivery boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS po_description text;

-- Verification:
-- select column_name, data_type, column_default from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_vendors'
--   and column_name in ('lead_time_days', 'free_delivery', 'po_description')
-- order by column_name;
-- Expected: 3 rows -- free_delivery boolean/false, lead_time_days integer/null, po_description text/null.

-- ------------------------------------------------------------
-- STATEMENT 8 of 8 -- verification-only, confirms the full new column
-- set together.
-- ------------------------------------------------------------
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_vendors'
--   and column_name in ('is_preferred','vendor_part_number','sku','delivery_method_id','delivery_days','lead_time_days','free_delivery','po_description')
-- order by column_name;
-- Expected: all 8 present.
