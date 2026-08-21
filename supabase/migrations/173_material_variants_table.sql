-- ============================================================
-- Migration 173: material_variants -- new table. Build 1 item 1.
-- Applied: PROPOSED, NOT run. Requires 171 (materials.length_uom) and
-- 172 (delivery_methods, for organization pattern only, no direct FK)
-- to already be pasted.
-- ============================================================
--
-- GENERATED COLUMNS -- sqft, total_cost, cost_per_unit, sell_per_unit.
-- Same discipline as payments.balance (migration 158): computed purely
-- from this row's own stored columns, STORED so they're indexable/
-- filterable, impossible to write directly, impossible to go stale.
--
-- WHY length_uom IS DUPLICATED ONTO THIS TABLE (read before changing):
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
-- WHY THE SAME SUB-EXPRESSION IS REPEATED ACROSS 4 COLUMNS:
-- PostgreSQL also does not allow a generated column to reference
-- ANOTHER generated column ("generation expression can refer to other
-- columns in the table, but not other generated columns" -- confirmed
-- in the CREATE TABLE docs). cost_per_unit and sell_per_unit therefore
-- each re-derive the area-conversion CASE and the total-cost sum inline
-- rather than referencing sqft/total_cost -- verbose, but it's the only
-- legal way to keep all four honest and stale-proof.
--
-- sqft: height * width, converted to square feet by length_uom.
--   'in' -> divide by 144 (in^2 -> ft^2); 'ft' -> as-is; 'yd' -> * 9
--   (yd^2 -> ft^2). NULL when either dimension is missing (e.g. the 8
--   Polycarbonate cut-to-length rows from Finding A, which get a
--   length_increment variant with no fixed height).
--
-- total_cost: base_cost + shipping_cost (shipping defaults to 0 when
--   unset so a variant without a known shipping figure still prices;
--   base_cost missing means "not priced yet" and stays NULL, not 0).
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
-- STATEMENT 1 of 5 -- create table.
-- ------------------------------------------------------------
CREATE TABLE public.material_variants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  material_id      uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,

  -- Dimensions -- shared pair, Roll vs Substrate/Sheet render order
  -- decided by Build 2 based on the material's type, not by schema.
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
  -- values.
  length_uom       text NOT NULL DEFAULT 'in' CHECK (length_uom IN ('in', 'ft', 'yd')),

  sqft numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN height IS NULL OR width IS NULL THEN NULL
      WHEN length_uom = 'in' THEN round((height * width) / 144.0, 4)
      WHEN length_uom = 'ft' THEN round(height * width, 4)
      WHEN length_uom = 'yd' THEN round((height * width) * 9.0, 4)
      ELSE NULL
    END
  ) STORED,

  total_cost numeric(12,4) GENERATED ALWAYS AS (
    CASE WHEN base_cost IS NULL THEN NULL ELSE base_cost + COALESCE(shipping_cost, 0) END
  ) STORED,

  cost_per_unit numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN base_cost IS NULL THEN NULL
      WHEN height IS NOT NULL AND width IS NOT NULL AND
           (CASE length_uom
              WHEN 'in' THEN (height * width) / 144.0
              WHEN 'ft' THEN height * width
              WHEN 'yd' THEN (height * width) * 9.0
              ELSE NULL
            END) > 0
      THEN round(
             (base_cost + COALESCE(shipping_cost, 0)) /
             (CASE length_uom
                WHEN 'in' THEN (height * width) / 144.0
                WHEN 'ft' THEN height * width
                WHEN 'yd' THEN (height * width) * 9.0
                ELSE NULL
              END), 4)
      ELSE round(base_cost + COALESCE(shipping_cost, 0), 4)
    END
  ) STORED,

  sell_per_unit numeric(12,4) GENERATED ALWAYS AS (
    CASE
      WHEN base_cost IS NULL OR multiplier IS NULL THEN NULL
      ELSE round(
        (CASE
           WHEN height IS NOT NULL AND width IS NOT NULL AND
                (CASE length_uom
                   WHEN 'in' THEN (height * width) / 144.0
                   WHEN 'ft' THEN height * width
                   WHEN 'yd' THEN (height * width) * 9.0
                   ELSE NULL
                 END) > 0
           THEN (base_cost + COALESCE(shipping_cost, 0)) /
                (CASE length_uom
                   WHEN 'in' THEN (height * width) / 144.0
                   WHEN 'ft' THEN height * width
                   WHEN 'yd' THEN (height * width) * 9.0
                   ELSE NULL
                 END)
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

-- Verification for statement 1:
-- select column_name, data_type, is_generated, generation_expression
-- from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_variants'
-- order by ordinal_position;
-- Expected: 20 columns; sqft/total_cost/cost_per_unit/sell_per_unit show is_generated = 'ALWAYS'.

-- ------------------------------------------------------------
-- STATEMENT 2 of 5 -- BEFORE INSERT OR UPDATE trigger: force
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

-- Verification for statement 2:
-- select tgname from pg_trigger where tgrelid = 'public.material_variants'::regclass;
-- Expected: sync_material_variant_before_write present alongside set_material_variants_updated_at.

-- ------------------------------------------------------------
-- STATEMENT 3 of 5 -- AFTER UPDATE trigger on materials: cascade a
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

-- Verification for statement 3:
-- select tgname from pg_trigger where tgrelid = 'public.materials'::regclass and tgname = 'cascade_material_length_uom_trigger';
-- Expected: one row.

-- ------------------------------------------------------------
-- STATEMENT 4 of 5 -- functional smoke test (run manually, then delete
-- the test row -- not part of the schema, just confirms the generated
-- columns and triggers behave before Build 2 relies on them).
-- ------------------------------------------------------------
-- insert into public.material_variants (material_id, height, width, base_cost, shipping_cost, multiplier, is_default)
-- select id, 48, 96, 100, 20, 2.0, true from public.materials
-- where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' limit 1
-- returning id, length_uom, sqft, total_cost, cost_per_unit, sell_per_unit;
--
-- Expected (assuming the parent material's length_uom defaulted to 'in'
-- from migration 171): length_uom='in', sqft=32.0000 (48*96/144),
-- total_cost=120.0000, cost_per_unit=3.7500 (120/32), sell_per_unit=7.5000.
--
-- delete from public.material_variants where sqft = 32.0000 and total_cost = 120.0000 and sell_per_unit = 7.5000;

-- ------------------------------------------------------------
-- STATEMENT 5 of 5 -- verification-only, confirms zero rows exist yet
-- (this is a brand-new table, nothing should be seeded by this file).
-- ------------------------------------------------------------
-- select count(*) from public.material_variants;
-- Expected: 0 (after deleting the statement-4 smoke-test row).
