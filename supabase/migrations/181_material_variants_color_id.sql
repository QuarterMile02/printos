-- ============================================================
-- Migration 181: material_variants.color_id -- Build 1b item 1.
-- Applied: PROPOSED, NOT run. Requires 173 (material_variants) and 174
-- (material_colors) already live.
-- ============================================================
--
-- Ruben's confirmed decision (Build 1b): Material = product line +
-- thickness (e.g. "Acrylic .118in - 1/8\""). Colours = material_colors
-- rows on that material. Variants = sheet sizes, and a size belongs to
-- a COLOUR, not just the material. Thickness stays part of material
-- identity; colour does not.
--
-- color_id NULL = "this size applies to the material regardless of
-- colour" -- i.e. materials with no colour list at all (most of the 235
-- Rigid Substrates- Sheets rows analyzed in Build 1b's report have no
-- distinguishable colour and will never get a material_colors row in
-- the first place -- for those, every variant's color_id stays NULL,
-- always). This is NOT a "no colour selected yet" placeholder state --
-- it's a real, permanent value for colourless materials.

-- ------------------------------------------------------------
-- STATEMENT 1 of 4 -- add the column.
-- ------------------------------------------------------------
ALTER TABLE public.material_variants
  ADD COLUMN IF NOT EXISTS color_id uuid REFERENCES public.material_colors(id) ON DELETE SET NULL;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'material_variants' and column_name = 'color_id';
-- Expected: one row -- color_id | uuid

-- ------------------------------------------------------------
-- STATEMENT 2 of 4 -- index.
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_material_variants_color ON public.material_variants(color_id);

-- Verification:
-- select indexname from pg_indexes where tablename = 'material_variants' and indexname = 'idx_material_variants_color';
-- Expected: one row.

-- ------------------------------------------------------------
-- STATEMENT 3 of 4 -- color_id must belong to the SAME material as the
-- variant row, same denormalization-safety discipline as everything
-- else in this schema (organization_id/length_uom already enforced by
-- migration 173's trigger). A color_id pointing at a DIFFERENT
-- material's colour would silently corrupt the size-belongs-to-colour
-- relationship Ruben just confirmed is the whole point of this column.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_material_variant_color() RETURNS trigger AS $$
DECLARE
  color_material_id uuid;
BEGIN
  IF NEW.color_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT material_id INTO color_material_id FROM public.material_colors WHERE id = NEW.color_id;
  IF color_material_id IS NULL THEN
    RAISE EXCEPTION 'material_variants.color_id % does not reference an existing material_colors row', NEW.color_id;
  END IF;
  IF color_material_id IS DISTINCT FROM NEW.material_id THEN
    RAISE EXCEPTION 'material_variants.color_id % belongs to a different material than this variant (color''s material_id=%, variant''s material_id=%)', NEW.color_id, color_material_id, NEW.material_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_material_variant_color_trigger ON public.material_variants;
CREATE TRIGGER validate_material_variant_color_trigger
  BEFORE INSERT OR UPDATE OF color_id, material_id ON public.material_variants
  FOR EACH ROW EXECUTE PROCEDURE validate_material_variant_color();

-- Verification:
-- select tgname from pg_trigger where tgrelid = 'public.material_variants'::regclass and tgname = 'validate_material_variant_color_trigger';
-- Expected: one row.

-- ------------------------------------------------------------
-- STATEMENT 4 of 4 -- one-default-per-material -> one-default-per-
-- (material, colour). Argued both ways below; this migration
-- implements the recommended option.
--
-- AGAINST changing it (keep one-default-per-material): simpler --
-- exactly one flag, one row, "the" default regardless of which colour
-- is picked. Matches how Build 1 originally built it, one line of
-- reasoning less for Build 2's form to carry.
--
-- FOR changing it to one-default-per-(material, colour): colour is now
-- a first-class concept THIS material redesign deliberately introduced
-- ("a size belongs to a COLOUR, not just the material"). A single
-- material-wide default becomes incoherent once a material has real
-- colours with different typical stock sizes -- e.g. Acrylic White
-- (7328) might default to 48x96, while Acrylic Transparent Lime Green
-- (9093) (Build 1b's own data: single-colour, no size token, i.e. it
-- IS the 48x96-style default for its own colour) has no reason to share
-- White's default flag or be unable to have its own. If Ruben picks
-- "Transparent Lime Green" on a quote, the system needs a sensible
-- default SIZE for that colour specifically, not a fallback to
-- whichever OTHER colour happened to hold the one material-wide flag.
--
-- RECOMMENDATION: one-default-per-(material, colour). It's the
-- constraint that actually matches the confirmed data model (colour
-- owns its sizes), and it degrades correctly for colourless materials
-- (color_id NULL) -- see the NULL-handling note below.
--
-- NULL-HANDLING GOTCHA, why this isn't a plain UNIQUE(material_id,
-- color_id) index: Postgres treats NULL as distinct from every other
-- NULL for uniqueness purposes, so a naive UNIQUE(material_id,
-- color_id) WHERE is_default would let a colourless material (color_id
-- NULL on every variant, the common case per Build 1b's own numbers)
-- have MANY is_default=true rows simultaneously -- exactly the bug this
-- constraint exists to prevent. Fixed by coalescing color_id to a fixed
-- sentinel UUID inside the index expression, so every NULL collapses
-- into the same comparable group.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_material_variants_one_default;

CREATE UNIQUE INDEX idx_material_variants_one_default_per_color
  ON public.material_variants(material_id, COALESCE(color_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default;

-- Verification:
-- select indexname from pg_indexes where tablename = 'material_variants' and indexname = 'idx_material_variants_one_default';
-- Expected: 0 rows (dropped).
-- select indexname, indexdef from pg_indexes where tablename = 'material_variants' and indexname = 'idx_material_variants_one_default_per_color';
-- Expected: one row, indexdef shows the COALESCE(color_id, '00000000-...') expression and "WHERE is_default".
--
-- -- Smoke test: two colourless variants both marked default on the SAME
-- -- material must now be rejected (second insert should error):
-- -- insert into material_variants (material_id, height, width, is_default)
-- -- select id, 48, 96, true from materials where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' limit 1
-- -- returning id;
-- -- insert into material_variants (material_id, height, width, is_default)
-- -- select id, 60, 120, true from materials where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' limit 1
-- -- returning id; -- EXPECT: unique constraint violation on idx_material_variants_one_default_per_color
-- -- delete from material_variants where height in (48, 60) and width in (96, 120) and is_default;
