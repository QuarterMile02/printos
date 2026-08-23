-- ============================================================
-- Migration 185: add_variant_to_existing_material -- generalized to a
-- multi-colour, multi-variant payload. Build item: "allow a multi-row
-- family to be added to an existing material."
-- Applied: PROPOSED, NOT run. Requires 183 (the original single-row
-- version of this function) already live -- confirmed live: the
-- singleton "add to existing material" workflow already works in
-- production today, which is only possible if 183 is applied.
-- ============================================================
--
-- WHY THIS REPLACES 183's FUNCTION RATHER THAN ADDING A NEW ONE: read
-- 183 first, in full, before touching this -- it does NOT handle a
-- multi-row payload as-is. Its payload is exactly one `colour` + one
-- `variant` + one `source_row_id`; calling it once per row for a
-- 12-row family would be 12 separate transactions, not one -- if row 7
-- of 12 failed (e.g. a missing multiplier), rows 1-6 would already be
-- committed. That is exactly the "not row by row, not partially"
-- failure this migration closes. This function is the only caller's
-- entry point (src/app/(dashboard)/dashboard/[slug]/settings/materials/
-- migrate/actions.ts) -- there is no other consumer to keep backward
-- compatible, and the client is updated in the same PR, so CREATE OR
-- REPLACE with a new payload shape is safe, not a breaking change to
-- anything still running the old shape.
--
-- New payload shape (see AddToExistingMaterialInput in
-- migrate/actions.ts for the exact TS type this mirrors -- the same
-- colours-then-variants nesting accept_family_proposal (182) already
-- uses, deliberately, for consistency):
-- {
--   "organization_id": uuid,
--   "material_id": uuid,               -- the EXISTING material to add to
--   "colours": [
--     {
--       "existing_color_id": uuid|null,  -- null = create a new colour/finish
--       "name": text|null,               -- used only when existing_color_id is null
--       "code": text|null,
--       "is_stocked": bool,
--       "variants": [
--         { "height", "width", "length_increment", "base_cost", "multiplier",
--           "is_default", "source_row_id" }
--       ]
--     }
--   ]
-- }
--
-- Every safeguard from 183 survives, just scoped per colour group
-- instead of once:
--   - org + colour ownership validation (colour must belong to
--     material_id, material_id must belong to organization_id)
--   - multiplier fail-loud -- material_variants.multiplier is NOT NULL
--     (migration 173), no COALESCE, ever. EXTENDED here per explicit
--     instruction: a multiplier of 0 is now ALSO treated as missing,
--     the same as NULL -- a real, live finding (16 Channel Letter rows
--     had exactly this shape: a real cost with multiplier = 0, which
--     would have produced a real, non-error $0.00 sell price). Not
--     retrofitted into accept_family_proposal (182) -- out of scope for
--     this migration, flagged separately.
--   - move-an-existing-default -- only moves the current default for a
--     colour when some variant in THAT colour's group explicitly claims
--     is_default = true, never as a side effect, still scoped per
--     colour (migration 181's unique index is per-(material, colour),
--     not per-material).
--
-- One transaction for the whole call, same reasoning as 182 and 183:
-- PostgREST has no client-side multi-statement transaction API. Every
-- colour and every variant in the payload either all land or (on any
-- error -- a missing multiplier, an ownership mismatch, the unique
-- index firing) none do.

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
    -- Resolve or create the colour/finish -- same rule as 183, per
    -- colour group in this payload.
    IF v_colour->>'existing_color_id' IS NOT NULL THEN
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
      RAISE EXCEPTION 'add_variant_to_existing_material: colour "%" has no size variants', COALESCE(v_colour->>'name', '(existing colour)');
    END IF;

    -- Move the existing default for THIS colour only if some variant in
    -- this colour's own group explicitly claims to be the new default --
    -- never as a side effect of adding an ordinary size, and scoped per
    -- colour so adding a default to colour A never touches colour B's
    -- default on the same material.
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

      -- multiplier: FAIL LOUDLY -- same rule as 183 and
      -- accept_family_proposal, EXTENDED per explicit instruction: a
      -- multiplier of 0 is treated exactly like NULL, refused, never
      -- defaulted. Real finding this closes: 16 Channel Letter rows had
      -- a real cost with multiplier = 0 -- would have produced a real,
      -- non-error $0.00 sell price, the same class of silent-wrong the
      -- COALESCE(multiplier, 2) bug already fixed once.
      IF v_variant->>'multiplier' IS NULL OR (v_variant->>'multiplier')::numeric = 0 THEN
        RAISE EXCEPTION 'add_variant_to_existing_material: no usable multiplier for a "%" variant (%x%) -- refusing to invent one (a multiplier of 0 is treated as missing, same as NULL). Every variant must carry its own real multiplier.',
          COALESCE(v_colour->>'name', '(existing colour)'), v_variant->>'height', v_variant->>'width';
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
  -- in one batch UPDATE -- same discipline as accept_family_proposal
  -- (182). Each row's source_hash is evaluated against its own live
  -- on-disk value at this exact moment, not a value threaded in from
  -- the client request.
  UPDATE public.shopvox_materials
     SET migrated_to_material_id = v_material_id,
         migrated_at = now(),
         migrated_source_hash = source_hash
   WHERE id = ANY(v_source_row_ids)
     AND organization_id = v_org_id;

  -- Returns the PARENT material's id, not a single variant id -- there
  -- is no longer one "the" variant for a multi-row call. Nothing in the
  -- client reads the old variantId value for anything but a truthy
  -- success check, so this is not a breaking change in practice, and
  -- the client is updated in this same PR regardless.
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
-- -- Setup: a real material with one existing colour and one default variant.
-- insert into materials (organization_id, name, length_uom, active)
-- values ('4ca12dff-97be-4472-8099-ab102a3af01a', 'RUNBOOK_TEST_PARENT 2.5Mil Oracal 651', 'in', true)
-- returning id; -- note the id, call it :parent_id
--
-- insert into material_colors (material_id, name, code) values (:parent_id, 'Black / White Colors', null) returning id; -- note as :bw_id
-- insert into material_variants (material_id, color_id, height, width, is_default, base_cost, multiplier)
-- values (:parent_id, :bw_id, 360, 24, true, 10, 3); -- the "x 10yds" (360in) variant, already migrated
--
-- -- Test A: add a MULTI-ROW family -- two colours, one existing (mapped
-- -- by id) with a new size, one brand-new colour with two sizes -- five
-- -- variants total, one call, one transaction.
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colours": [
--     {
--       "existing_color_id": "' || :'bw_id' || '",
--       "variants": [
--         {"height": 1800, "width": 24, "base_cost": 11, "multiplier": 3, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000001"}
--       ]
--     },
--     {
--       "existing_color_id": null, "name": "Colors", "code": null, "is_stocked": false,
--       "variants": [
--         {"height": 360, "width": 24, "base_cost": 12, "multiplier": 3, "is_default": true, "source_row_id": "00000000-0000-0000-0000-000000000002"},
--         {"height": 1800, "width": 24, "base_cost": 13, "multiplier": 3, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000003"}
--       ]
--     }
--   ]
-- }')::jsonb);
-- select mc.name, mv.height, mv.width, mv.is_default from material_variants mv join material_colors mc on mc.id = mv.color_id where mv.material_id = :'parent_id' order by mc.name, mv.height;
-- Expected: 4 rows total -- "Black / White Colors" now has 2 variants (360 still default, 1800 new, not default);
-- new colour "Colors" has 2 variants (360 default=true, 1800 default=false). No cross-colour default was moved.
--
-- select count(*) from shopvox_materials where id in (
--   '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'
-- ) and migrated_to_material_id = :'parent_id';
-- Expected: 0 (these are dummy ids for the smoke test, not real rows -- in real use every source_row_id must be a real shopvox_materials id).
--
-- -- Test B: multiplier = 0 -- must fail loudly, exactly like NULL, nothing partial lands.
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colours": [
--     {"existing_color_id": "' || :'bw_id' || '", "variants": [
--       {"height": 900, "width": 24, "base_cost": 5, "multiplier": 0, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000004"}
--     ]}
--   ]
-- }')::jsonb);
-- Expected: ERROR -- "...no usable multiplier for a ... variant (900x24) -- refusing to invent one (a multiplier of 0 is treated as missing, same as NULL)...".
-- select count(*) from material_variants where material_id = :'parent_id' and height = 900;
-- Expected: 0.
--
-- -- Test C: a payload with TWO colours, second one missing a multiplier
-- -- on its second variant -- proves the WHOLE call rolls back, not just
-- -- the failing colour.
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colours": [
--     {"existing_color_id": null, "name": "PartialTest", "variants": [
--       {"height": 100, "width": 24, "base_cost": 5, "multiplier": 3, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000005"}
--     ]},
--     {"existing_color_id": null, "name": "PartialTest2", "variants": [
--       {"height": 200, "width": 24, "base_cost": 5, "multiplier": null, "is_default": false, "source_row_id": "00000000-0000-0000-0000-000000000006"}
--     ]}
--   ]
-- }')::jsonb);
-- Expected: ERROR.
-- select count(*) from material_colors where material_id = :'parent_id' and name = 'PartialTest';
-- Expected: 0 -- the first colour's INSERT rolled back too, even though it alone was valid.
--
-- -- Cleanup:
-- delete from materials where id = :'parent_id'; -- cascades to material_colors, material_variants
