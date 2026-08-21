-- ============================================================
-- Migration 173: material_variants -- new table. Build 1 item 1.
-- Applied: PROPOSED, NOT run. Requires 171 (materials.length_uom) and
-- 172 (delivery_methods, for organization pattern only, no direct FK)
-- to already be pasted.
-- ============================================================
--
-- ****************************************************************
-- *** BUG FIXED 2026-08-21 -- read this before touching sqft/cost_
-- *** per_unit/sell_per_unit again. Caught by Ruben before the runbook
-- *** got past step 17 -- steps 1-17 (materials fields, delivery_
-- *** methods) were already live and are unaffected; this file had not
-- *** been run yet.
-- ****************************************************************
--
-- WHICH COLUMN IS WHICH (this is the fact the original bug got wrong --
-- state it explicitly so the next person can't get it backwards):
--   - `width` is ALWAYS in inches, full stop, for every material kind.
--     There is no unit conversion on width, ever -- it has no UOM
--     column of its own because it doesn't need one.
--   - `height` is the dimension `length_uom` actually governs. For a
--     SHEET, that's the sheet's own height, normally also inches
--     (length_uom = 'in' is the default from migration 171). For a
--     ROLL, `height` is what Build 2's UI labels "Length" -- e.g. a 38"
--     wide roll that is 50 YARDS long stores width=38, height=50,
--     length_uom='yd'. Only `height` ever gets converted by length_uom;
--     `width` never does.
--
-- THE ORIGINAL BUG: the first version of this file's sqft expression
-- was square-inches/square-feet/square-yards math --
--   'in' -> (h*w)/144      'ft' -> h*w        'yd' -> (h*w)*9
-- -- i.e. it applied length_uom to the AREA (both dimensions at once,
-- as if width also carried a yard/foot unit). For a sheet where both
-- dimensions really are inches this happens to produce the right
-- number by coincidence (that's why the original smoke test, which
-- only covered length_uom='in', passed review) -- but for a roll it is
-- wrong by the square of the unit conversion. A 38" x 50yd roll
-- (true answer: 475 sqft) came out as (38*50)*9 = 17,100 -- 36x high,
-- which makes cost_per_unit 36x LOW and would have underpriced every
-- quote built on a roll material.
--
-- THE FIX: convert EACH SIDE TO FEET SEPARATELY, then multiply --
-- width_ft = width / 12 (always -- width is always inches), length_ft
-- = height converted by length_uom. 38" x 50yd: width_ft = 38/12 =
-- 3.1667, length_ft = 50*3 = 150, sqft = 3.1667*150 = 475.0000 --
-- correct, and confirmed to agree with the equivalent 38" x 150ft
-- statement of the exact same physical roll (length_ft = 150*1 = 150,
-- same 475.0000). Both are asserted equal in the smoke test below --
-- if a future edit breaks that agreement, the smoke test catches it.
--
-- material_length_to_feet(value, uom) -- extracted into its own
-- IMMUTABLE SQL function (created below, BEFORE the table, since a
-- generated column's expression must be able to resolve every function
-- it calls at CREATE TABLE time) so the to-feet conversion exists in
-- exactly ONE place instead of being retyped inline in sqft,
-- cost_per_unit, AND sell_per_unit. The original bug was one wrong
-- CASE expression copy-pasted three times, turning one mistake into
-- four wrong columns (sqft plus the two that depend on it) -- this is
-- the fix for that failure mode, not just for the arithmetic. A
-- generated column CANNOT reference another generated column or
-- another table (see the note below, unchanged from before), but CAN
-- call an IMMUTABLE function -- that restriction only blocks the
-- cross-table/cross-generated-column cases, not this one.
--
-- GENERATED COLUMNS -- sqft, total_cost, cost_per_unit, sell_per_unit.
-- Same discipline as payments.balance (migration 158): computed purely
-- from this row's own stored columns, STORED so they're indexable/
-- filterable, impossible to write directly, impossible to go stale.
--
-- WHY length_uom IS DUPLICATED ONTO THIS TABLE (unchanged from before
-- the bug fix -- this part was never wrong):
-- The spec says "materials.length_uom drives the conversion" -- but
-- PostgreSQL generated-column expressions can only reference columns of
-- the SAME row/table; they cannot join to another table (no subqueries
-- allowed in a generation expression). sqft cannot be `GENERATED ALWAYS
-- AS (... using materials.length_uom ...)` -- that's not legal SQL.
-- The only way to honor "length_uom drives the conversion" AND get a
-- true generated (never-stale) sqft is to carry length_uom on this row
-- too, kept in sync by trigger rather than by the app remembering to
-- copy it. Two triggers below do that:
--   1. BEFORE INSERT OR UPDATE ON material_variants -- forces
--      organization_id and length_uom to always match the parent
--      material, regardless of what the app sent. You cannot set either
--      to something the material disagrees with.
--   2. AFTER UPDATE OF length_uom ON materials -- cascades a changed
--      unit down to every existing variant of that material, so sqft
--      (and therefore cost_per_unit/sell_per_unit) recompute immediately
--      rather than silently keeping the old unit's math.
-- This mirrors the existing denormalized-organization_id precedent
-- already used by material_vendors and material_pricing_tiers in this
-- schema (both carry their own organization_id rather than joining
-- through material_id every time).
--
-- total_cost: base_cost + shipping_cost (shipping defaults to 0 when
--   unset so a variant without a known shipping figure still prices;
--   base_cost missing means "not priced yet" and stays NULL, not 0).
--   Unaffected by the bug -- no dimension math involved.
--
-- cost_per_unit: total_cost normalized to $/sqft when the variant has
--   real area; falls back to total_cost itself (treated as "per each")
--   when there's no area to normalize by -- e.g. a length_increment
--   cut-to-length variant with no height, or a future non-substrate
--   "Unit" kind. ASSUMPTION, flagged: the spec didn't define
--   cost_per_unit's fallback behavior for area-less variants explicitly
--   -- this is the interpretation that keeps every variant priceable
--   rather than silently NULL.
--
-- sell_per_unit: cost_per_unit * multiplier. NULL if either base_cost
--   or multiplier is unset -- an unpriced or unmarked-up variant has no
--   sell price rather than a misleading $0.
--
-- Sheets/rolls render Height-then-Width vs Width-then-Length using the
-- SAME height/width columns -- that's a render-time label decision in
-- Build 2 (the form), not a schema concern; no separate columns needed.

-- ------------------------------------------------------------
-- STATEMENT 1 of 6 -- IMMUTABLE helper: converts a dimension value to
-- feet given its unit. Used for `height` only -- `width` is always
-- inches and is divided by 12 directly at each call site, no function
-- needed for that side (see header comment on which column is which).
-- Must exist BEFORE the table below, since material_variants'
-- generated columns call it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION material_length_to_feet(value numeric, uom text)
RETURNS numeric AS $$
  SELECT CASE uom
    WHEN 'in' THEN value / 12.0
    WHEN 'ft' THEN value
    WHEN 'yd' THEN value * 3.0
    ELSE NULL
  END
$$ LANGUAGE sql IMMUTABLE;

-- Verification for statement 1:
-- select proname, provolatile from pg_proc where proname = 'material_length_to_feet' and pronamespace = 'public'::regnamespace;
-- Expected: one row, provolatile = 'i' (immutable).
--
-- select material_length_to_feet(50, 'yd'), material_length_to_feet(150, 'ft'), material_length_to_feet(96, 'in');
-- Expected: 150.0, 150.0, 8.0000000000000000 (all three are "150 feet" except the last, 96in = 8ft).

-- ------------------------------------------------------------
-- STATEMENT 2 of 6 -- create table.
-- ------------------------------------------------------------
CREATE TABLE public.material_variants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id      uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,

  -- Dimensions -- shared pair, Roll vs Substrate/Sheet render order
  -- decided by Build 2 based on the material's type, not by schema.
  -- width is ALWAYS inches (see header). height is what length_uom
  -- governs -- a roll's "Length" per the approved layout.
  height           numeric(10,4),
  width            numeric(10,4),

  -- NULL = fixed size. Non-null = cut-to-length, ordered in that
  -- increment (e.g. Polycarbonate reel items = 12). Quote-time length
  -- rounds UP to the next increment -- Build 2 / pricing engine concern,
  -- not enforced in schema.
  length_increment numeric(10,4),

  thickness        numeric(10,4),
  core_diameter    numeric(10,4),
  direction        text,                    -- e.g. grain direction; no fixed domain given, free text

  shipping_cost    numeric(12,4),
  base_cost        numeric(12,4),
  multiplier       numeric(10,4) NOT NULL DEFAULT 1,

  min_qty          integer,
  max_qty          integer,
  on_hand          numeric(12,4),

  is_default       boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,

  -- Denormalized from materials -- see header comment. Always
  -- overwritten by the BEFORE trigger below; do not rely on app-supplied
  -- values. Governs `height` (the length dimension) only -- `width` is
  -- always inches regardless of this value.
  length_uom       text NOT NULL DEFAULT 'in' CHECK (length_uom IN ('in', 'ft', 'yd')),

  -- width_ft = width/12 (width is always inches). length_ft =
  -- material_length_to_feet(height, length_uom). sqft = width_ft *
  -- length_ft. Fixed 2026-08-21 -- see header for the bug this replaced.
  sqft numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN height IS NULL OR width IS NULL THEN NULL
      ELSE round((width / 12.0) * material_length_to_feet(height, length_uom), 4)
    END
  ) STORED,

  total_cost numeric(12,4) GENERATED ALWAYS AS (
    CASE WHEN base_cost IS NULL THEN NULL ELSE base_cost + COALESCE(shipping_cost, 0) END
  ) STORED,

  cost_per_unit numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN base_cost IS NULL THEN NULL
      WHEN height IS NOT NULL AND width IS NOT NULL
           AND (width / 12.0) * material_length_to_feet(height, length_uom) > 0
      THEN round(
             (base_cost + COALESCE(shipping_cost, 0)) /
             ((width / 12.0) * material_length_to_feet(height, length_uom)), 4)
      ELSE round(base_cost + COALESCE(shipping_cost, 0), 4)
    END
  ) STORED,

  sell_per_unit numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN base_cost IS NULL OR multiplier IS NULL THEN NULL
      ELSE round(
        (CASE
           WHEN height IS NOT NULL AND width IS NOT NULL
                AND (width / 12.0) * material_length_to_feet(height, length_uom) > 0
           THEN (base_cost + COALESCE(shipping_cost, 0)) /
                ((width / 12.0) * material_length_to_feet(height, length_uom))
           ELSE (base_cost + COALESCE(shipping_cost, 0))
         END) * multiplier, 4)
    END
  ) STORED,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (min_qty IS NULL OR max_qty IS NULL OR min_qty <= max_qty)
);

DROP TRIGGER IF EXISTS set_material_variants_updated_at ON public.material_variants;
CREATE TRIGGER set_material_variants_updated_at
  BEFORE UPDATE ON public.material_variants
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- At most one default variant per material.
CREATE UNIQUE INDEX idx_material_variants_one_default
  ON public.material_variants(material_id) WHERE is_default;

CREATE INDEX idx_material_variants_material ON public.material_variants(material_id);
CREATE INDEX idx_material_variants_org ON public.material_variants(organization_id);

ALTER TABLE public.material_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage material_variants" ON public.material_variants
  FOR ALL
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_variants TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_variants TO service_role;
REVOKE ALL ON public.material_variants FROM anon;

-- Verification for statement 2:
-- select column_name, data_type, is_generated, generation_expression
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_variants'
-- order by ordinal_position;
-- Expected: 20 columns; sqft/total_cost/cost_per_unit/sell_per_unit show is_generated = 'ALWAYS'.

-- ------------------------------------------------------------
-- STATEMENT 3 of 6 -- BEFORE INSERT OR UPDATE trigger: force
-- organization_id and length_uom to always match the parent material.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_material_variant_from_parent() RETURNS trigger AS $$
BEGIN
  SELECT m.organization_id, m.length_uom
    INTO NEW.organization_id, NEW.length_uom
    FROM public.materials m
   WHERE m.id = NEW.material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'material_variants.material_id % does not reference an existing material', NEW.material_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_material_variant_before_write ON public.material_variants;
CREATE TRIGGER sync_material_variant_before_write
  BEFORE INSERT OR UPDATE OF material_id ON public.material_variants
  FOR EACH ROW EXECUTE PROCEDURE sync_material_variant_from_parent();

-- Verification for statement 3:
-- select tgname from pg_trigger where tgrelid = 'public.material_variants'::regclass;
-- Expected: sync_material_variant_before_write present alongside set_material_variants_updated_at.

-- ------------------------------------------------------------
-- STATEMENT 4 of 6 -- AFTER UPDATE trigger on materials: cascade a
-- changed length_uom down to every existing variant, so sqft/cost_per_
-- unit/sell_per_unit recompute against the new unit rather than the one
-- they were created under.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION cascade_material_length_uom() RETURNS trigger AS $$
BEGIN
  IF NEW.length_uom IS DISTINCT FROM OLD.length_uom THEN
    UPDATE public.material_variants
       SET length_uom = NEW.length_uom
     WHERE material_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cascade_material_length_uom_trigger ON public.materials;
CREATE TRIGGER cascade_material_length_uom_trigger
  AFTER UPDATE OF length_uom ON public.materials
  FOR EACH ROW EXECUTE PROCEDURE cascade_material_length_uom();

-- Verification for statement 4:
-- select tgname from pg_trigger where tgrelid = 'public.materials'::regclass and tgname = 'cascade_material_length_uom_trigger';
-- Expected: one row.

-- ------------------------------------------------------------
-- STATEMENT 5 of 6 -- functional smoke test, THREE cases (run
-- manually, then delete the test rows -- not part of the schema).
-- Case 1 is a sheet (length_uom='in', both dimensions inches) -- the
-- one case the ORIGINAL buggy formula also got right, which is why it
-- passed review before. Cases 2 and 3 describe the SAME physical roll
-- two different ways (50 yards == 150 feet) -- they must agree, or the
-- conversion is wrong again.
-- ------------------------------------------------------------
-- -- Case 1: 48 x 96 sheet, 'in' -> expect sqft 32.0000
-- insert into public.material_variants (material_id, height, width, length_uom, base_cost, shipping_cost, multiplier, is_default)
-- select id, 96, 48, 'in', 100, 20, 2.0, true from public.materials
-- where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' limit 1
-- returning id, length_uom, sqft, total_cost, cost_per_unit, sell_per_unit;
-- -- Expected: sqft=32.0000, total_cost=120.0000, cost_per_unit=3.7500, sell_per_unit=7.5000.
--
-- -- Case 2: 38in wide x 50yd long roll -> expect sqft 475.0000
-- insert into public.material_variants (material_id, height, width, length_uom, base_cost, shipping_cost, multiplier)
-- select id, 50, 38, 'yd', 950, 50, 2.0 from public.materials
-- where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' limit 1
-- returning id, length_uom, sqft, total_cost, cost_per_unit, sell_per_unit;
-- -- Expected: sqft=475.0000, total_cost=1000.0000, cost_per_unit=2.1053 (1000/475), sell_per_unit=4.2105.
--
-- -- Case 3: the SAME roll stated as 38in wide x 150ft long -> must also be sqft 475.0000
-- insert into public.material_variants (material_id, height, width, length_uom, base_cost, shipping_cost, multiplier)
-- select id, 150, 38, 'ft', 950, 50, 2.0 from public.materials
-- where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' limit 1
-- returning id, length_uom, sqft, total_cost, cost_per_unit, sell_per_unit;
-- -- Expected: sqft=475.0000 -- IDENTICAL to case 2. If this differs from case 2's sqft, the conversion is wrong.
--
-- -- Cross-check case 2 vs case 3 agree:
-- select count(distinct sqft) from public.material_variants where sqft = 475.0000;
-- -- Expected: 1 (both rows share the exact same sqft value).
--
-- delete from public.material_variants where sqft in (32.0000, 475.0000);

-- ------------------------------------------------------------
-- STATEMENT 6 of 6 -- verification-only, confirms zero rows exist yet
-- (this is a brand-new table, nothing should be seeded by this file).
-- ------------------------------------------------------------
-- select count(*) from public.material_variants;
-- Expected: 0 (after deleting the statement-5 smoke-test rows).
