-- ============================================================
-- Migration 186: add_variant_to_existing_material -- add an explicit
-- "no colour/finish" target. Bug fix on top of 185 (already applied
-- live -- do not edit 185's file, CREATE OR REPLACE again here, same
-- pattern 185 itself used against 183).
-- ============================================================
--
-- THE BUG, reproduced live: a proposal whose one colour/finish group is
-- "(none)" (e.g. "Magnet Digital 30Mil Magnum 24in" -- line + axis +
-- brand only, no colour/finish token anywhere in the name, confirmed
-- legitimate, not a parse miss) could not be added to an existing
-- material at all. Two things were wrong, one client-side (fixed in the
-- same PR as this migration, see migrate-client.tsx /
-- actions.ts), one here:
--
--   185's colour-resolution branch was:
--     IF existing_color_id IS NOT NULL THEN <map to it>
--     ELSE <ALWAYS INSERT a material_colors row, even with a NULL name>
--   There was no way to express "no colour/finish, attach with
--   color_id NULL directly" at all -- the only path with
--   existing_color_id NULL unconditionally created a material_colors
--   row, even when name and code were both NULL. That is NOT the same
--   thing as no colour/finish: migration 181's one-default-per-colour
--   unique index buckets on COALESCE(color_id, '00000000-...'), so a
--   real (nameless) material_colors row and color_id actually NULL are
--   two different buckets. A material built via Accept ("accept
--   family proposal") with a colour-less group gets color_id NULL
--   directly and NO material_colors row (confirmed by reading 182,
--   accept_family_proposal, directly -- see below); a material folded
--   in via 185's old "existing_color_id null" branch would instead have
--   gotten a stray, nameless material_colors row -- a structurally
--   different, wrong shape for what should be the identical case.
--
-- READ 182 (accept_family_proposal) FIRST, MIRRORED HERE EXACTLY: its
-- rule is "colour.name IS NULL or blank -> no material_colors row,
-- color_id NULL directly" (lines ~131-137 of 182). This migration adds
-- an explicit `no_colour_finish` boolean to each colour object instead
-- of relying on an inferred blank name, because 185's payload already
-- has THREE meaningfully different colour targets to express (map to
-- existing / create new / no colour at all) and leaving one of them to
-- be inferred from "name happens to be blank" is exactly the kind of
-- implicit convention that produced this bug in the first place. The
-- resulting DB shape is identical to what 182 already produces for a
-- colour-less group -- color_id NULL, no material_colors row -- so a
-- material built by Accept and a material added to by this path end up
-- structurally identical, which was the explicit goal.
--
-- New payload shape (colour object only; everything else unchanged
-- from 185):
-- {
--   "existing_color_id": uuid|null,
--   "no_colour_finish": bool,   -- NEW. true = color_id NULL, no material_colors row.
--                                  Mutually exclusive with existing_color_id being set.
--                                  When true, name/code are ignored.
--   "name": text|null,          -- used only when existing_color_id is null AND no_colour_finish is false
--   "code": text|null,
--   "is_stocked": bool,
--   "variants": [ ... unchanged ... ]
-- }
--
-- Every safeguard from 185 survives unchanged, and the two that are
-- keyed on color_id (move-an-existing-default, sort_order) already use
-- `color_id IS NOT DISTINCT FROM v_colour_id` -- NULL-safe equality --
-- so they correctly scope to the NULL bucket for a no-colour-finish
-- group with ZERO additional code: adding a no-colour-finish default
-- moves the material's existing NULL-bucket default (if any), never a
-- named colour's default, and vice versa. Confirmed by inspection, not
-- just assumed, since this is exactly the kind of edge this bug already
-- proved worth checking directly:
--   - org + colour ownership validation: unchanged.
--   - multiplier fail-loud, 0 treated as missing same as NULL: unchanged.
--   - one transaction, all-or-nothing: unchanged.

-- ------------------------------------------------------------
-- STATEMENT 1 of 2 -- replace the function.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_variant_to_existing_material(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id uuid := (payload->>'organization_id')::uuid;
  v_material_id uuid := (payload->>'material_id')::uuid;
  v_material_org_id uuid;
  v_colour jsonb;
  v_variant jsonb;
  v_colour_id uuid;
  v_colour_material_id uuid;
  v_no_colour_finish boolean;
  v_is_default boolean;
  v_next_sort_order integer;
  v_new_variant_id uuid;
  v_source_row_id uuid;
  v_source_row_ids uuid[] := '{}';
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: organization_id is required';
  END IF;
  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: material_id is required';
  END IF;
  IF jsonb_array_length(COALESCE(payload->'colours', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: at least one colour group (variants list) is required';
  END IF;

  SELECT organization_id INTO v_material_org_id FROM public.materials WHERE id = v_material_id;
  IF v_material_org_id IS NULL THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: material_id % does not reference an existing material', v_material_id;
  END IF;
  IF v_material_org_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: material_id % belongs to a different organization', v_material_id;
  END IF;

  FOR v_colour IN SELECT * FROM jsonb_array_elements(payload->'colours')
  LOOP
    v_no_colour_finish := COALESCE((v_colour->>'no_colour_finish')::boolean, false);

    -- Resolve the colour/finish target -- three mutually exclusive
    -- cases, in priority order:
    --   1. no_colour_finish: color_id NULL directly, no row created.
    --      Mirrors accept_family_proposal's (182) own handling of a
    --      colour group with a blank name -- same DB shape either way.
    --   2. existing_color_id set: map onto that row (ownership checked).
    --   3. neither: create a brand-new material_colors row -- same as
    --      185, unchanged.
    IF v_no_colour_finish THEN
      v_colour_id := NULL;
    ELSIF v_colour->>'existing_color_id' IS NOT NULL THEN
      v_colour_id := (v_colour->>'existing_color_id')::uuid;
      SELECT material_id INTO v_colour_material_id FROM public.material_colors WHERE id = v_colour_id;
      IF v_colour_material_id IS NULL THEN
        RAISE EXCEPTION 'add_variant_to_existing_material: colour % does not exist', v_colour_id;
      END IF;
      IF v_colour_material_id IS DISTINCT FROM v_material_id THEN
        RAISE EXCEPTION 'add_variant_to_existing_material: colour % belongs to a different material than material_id %', v_colour_id, v_material_id;
      END IF;
    ELSE
      INSERT INTO public.material_colors (material_id, name, code, is_stocked)
      VALUES (v_material_id, NULLIF(v_colour->>'name', ''), NULLIF(v_colour->>'code', ''), COALESCE((v_colour->>'is_stocked')::boolean, false))
      RETURNING id INTO v_colour_id;
    END IF;

    IF jsonb_array_length(COALESCE(v_colour->'variants', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'add_variant_to_existing_material: colour "%" has no size variants', COALESCE(v_colour->>'name', '(no colour/finish)');
    END IF;

    -- Move the existing default for THIS colour (or THIS material's
    -- NULL-colour bucket, when v_colour_id is NULL -- "IS NOT DISTINCT
    -- FROM" is NULL-safe equality, so this already scopes correctly to
    -- the no-colour-finish bucket with no extra branch needed) only if
    -- some variant in this group explicitly claims to be the new
    -- default -- never as a side effect, never crossing buckets.
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_colour->'variants') vv
      WHERE COALESCE((vv->>'is_default')::boolean, false)
    ) THEN
      UPDATE public.material_variants
         SET is_default = false
       WHERE material_id = v_material_id
         AND color_id IS NOT DISTINCT FROM v_colour_id
         AND is_default = true;
    END IF;

    FOR v_variant IN SELECT * FROM jsonb_array_elements(v_colour->'variants')
    LOOP
      v_source_row_id := NULLIF(v_variant->>'source_row_id', '')::uuid;
      IF v_source_row_id IS NULL THEN
        RAISE EXCEPTION 'add_variant_to_existing_material: source_row_id is required for every variant';
      END IF;

      -- multiplier: FAIL LOUDLY -- unchanged from 185. A multiplier of
      -- 0 is treated exactly like NULL, refused, never defaulted.
      IF v_variant->>'multiplier' IS NULL OR (v_variant->>'multiplier')::numeric = 0 THEN
        RAISE EXCEPTION 'add_variant_to_existing_material: no usable multiplier for a "%" variant (%x%) -- refusing to invent one (a multiplier of 0 is treated as missing, same as NULL). Every variant must carry its own real multiplier.',
          COALESCE(v_colour->>'name', '(no colour/finish)'), v_variant->>'height', v_variant->>'width';
      END IF;

      v_is_default := COALESCE((v_variant->>'is_default')::boolean, false);

      SELECT COALESCE(MAX(sort_order) + 1, 0) INTO v_next_sort_order
        FROM public.material_variants
       WHERE material_id = v_material_id
         AND color_id IS NOT DISTINCT FROM v_colour_id;

      INSERT INTO public.material_variants (
        material_id, color_id, height, width, length_increment,
        is_default, base_cost, multiplier, sort_order
      ) VALUES (
        v_material_id, v_colour_id,
        (v_variant->>'height')::numeric,
        (v_variant->>'width')::numeric,
        (v_variant->>'length_increment')::numeric,
        v_is_default,
        (v_variant->>'base_cost')::numeric,
        (v_variant->>'multiplier')::numeric,
        v_next_sort_order
      )
      RETURNING id INTO v_new_variant_id;

      v_source_row_ids := array_append(v_source_row_ids, v_source_row_id);
    END LOOP;
  END LOOP;

  -- migrated_source_hash = source_hash: read fresh, live, for every row
  -- in one batch UPDATE -- unchanged from 185.
  UPDATE public.shopvox_materials
     SET migrated_to_material_id = v_material_id,
         migrated_at = now(),
         migrated_source_hash = source_hash
   WHERE id = ANY(v_source_row_ids)
     AND organization_id = v_org_id;

  RETURN v_material_id;
END;
$$;

GRANT EXECUTE ON FUNCTION add_variant_to_existing_material(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION add_variant_to_existing_material(jsonb) TO service_role;
REVOKE ALL ON FUNCTION add_variant_to_existing_material(jsonb) FROM anon;

-- Verification for statement 1:
-- select proname from pg_proc where proname = 'add_variant_to_existing_material' and pronamespace = 'public'::regnamespace;
-- Expected: one row (CREATE OR REPLACE keeps the same function identity).
-- select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'add_variant_to_existing_material';
-- Expected: authenticated and service_role rows with EXECUTE, no anon row.

-- ------------------------------------------------------------
-- STATEMENT 2 of 2 -- functional smoke tests.
-- ------------------------------------------------------------
-- -- Setup: a real material with one existing NAMED colour + default
-- -- variant, AND one existing colour-LESS (color_id NULL) default
-- -- variant -- reproduces "Magnet Digital 30Mil Magnum", which already
-- -- has NULL-colour variants from its original accept_family_proposal.
-- insert into materials (organization_id, name, length_uom, active)
-- values ('4ca12dff-97be-4472-8099-ab102a3af01a', 'RUNBOOK_TEST_PARENT2 30Mil Magnum', 'in', true)
-- returning id; -- note as :parent_id
--
-- insert into material_colors (material_id, name, code) values (:parent_id, 'Named', null) returning id; -- note as :named_id
-- insert into material_variants (material_id, color_id, height, width, is_default, base_cost, multiplier)
-- values (:parent_id, :named_id, 48, 24, true, 10, 3);
-- insert into material_variants (material_id, color_id, height, width, is_default, base_cost, multiplier)
-- values (:parent_id, null, 300, 48, true, 20, 3); -- existing colour-less default, e.g. the "25ft" variant
--
-- -- Test A: THE EXACT REPRODUCTION -- a colour-less family, 2 rows,
-- -- added to this material. Must land with color_id NULL, no stray
-- -- material_colors row, and correctly become the new colour-less
-- -- default (moving the 300/48 default above, not the "Named" colour's).
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colours": [
--     {
--       "existing_color_id": null, "no_colour_finish": true, "name": null, "code": null, "is_stocked": false,
--       "variants": [
--         {"height": 300, "width": 48, "base_cost": 21, "multiplier": 3, "is_default": true,  "source_row_id": "00000000-0000-0000-0000-000000000010"},
--         {"height": 600, "width": 48, "base_cost": 22, "multiplier": 3, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000011"}
--       ]
--     }
--   ]
-- }')::jsonb);
--
-- select mc.name, mv.height, mv.width, mv.color_id, mv.is_default
-- from material_variants mv left join material_colors mc on mc.id = mv.color_id
-- where mv.material_id = :'parent_id' order by mc.name nulls first, mv.height;
-- Expected: 4 rows -- "Named"/48x24/default=true (untouched); 3 rows with color_id NULL --
-- the pre-existing 300/48 (now default=false, its default was moved), and the two new
-- 300/48 and 600/48 rows (300/48 is_default=true, 600/48 is_default=false).
--
-- select count(*) from material_colors where material_id = :'parent_id' and name is null;
-- Expected: 0 -- no stray nameless material_colors row was created for the no-colour-finish group.
--
-- select count(*) from shopvox_materials where id in (
--   '00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011'
-- ) and migrated_to_material_id = :'parent_id';
-- Expected: 0 (dummy ids, not real rows -- in real use every source_row_id must be real).
--
-- -- Test B: a coloured group in the SAME call as a no-colour-finish
-- -- group -- proves the mixed-payload path lands both, and the
-- -- no-colour-finish default move never touches the named colour.
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colours": [
--     {"existing_color_id": "' || :'named_id' || '", "no_colour_finish": false, "variants": [
--       {"height": 96, "width": 24, "base_cost": 12, "multiplier": 3, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000012"}
--     ]},
--     {"existing_color_id": null, "no_colour_finish": true, "name": null, "code": null, "variants": [
--       {"height": 900, "width": 48, "base_cost": 23, "multiplier": 3, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000013"}
--     ]}
--   ]
-- }')::jsonb);
-- select mc.name, mv.height, mv.width, mv.color_id, mv.is_default
-- from material_variants mv left join material_colors mc on mc.id = mv.color_id
-- where mv.material_id = :'parent_id' order by mc.name nulls first, mv.height;
-- Expected: 6 rows total now -- "Named" gained 96x24 (default untouched, still 48x24);
-- NULL-colour bucket gained 900x48 (default untouched, still 300x48 from Test A).
--
-- -- Test C: no_colour_finish=true with a non-null name -- name/code
-- -- must be ignored, not silently create a named colour instead.
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colours": [
--     {"existing_color_id": null, "no_colour_finish": true, "name": "Should Be Ignored", "code": null, "variants": [
--       {"height": 999, "width": 48, "base_cost": 5, "multiplier": 3, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000014"}
--     ]}
--   ]
-- }')::jsonb);
-- select count(*) from material_colors where material_id = :'parent_id' and name = 'Should Be Ignored';
-- Expected: 0.
-- select color_id from material_variants where material_id = :'parent_id' and height = 999;
-- Expected: one row, color_id NULL.
--
-- -- Cleanup:
-- delete from materials where id = :'parent_id'; -- cascades to material_colors, material_variants
