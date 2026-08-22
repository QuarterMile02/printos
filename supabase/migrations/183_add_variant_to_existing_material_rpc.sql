-- ============================================================
-- Migration 183: add_variant_to_existing_material RPC -- item 1.
-- Applied: PROPOSED, NOT run. Requires 173 (material_variants), 174
-- (material_colors), 179 (shopvox_materials), 181 (material_variants.
-- color_id + the one-default-per-colour index), and 182
-- (accept_family_proposal, for the multiplier fail-loud precedent this
-- mirrors) already live. Per instruction: 179/181/182 ARE already live
-- in production -- this migration does not assume otherwise about any
-- other file in this directory either.
-- ============================================================
--
-- Ruben's actual workflow: fold a leftover shopvox_materials row INTO
-- an existing (already-accepted) material as another colour/finish or
-- another size, rather than creating a redundant new material. He does
-- this FIRST, before ever accepting a row as its own material -- "does
-- this belong somewhere?" has to be cheap to answer, or he'd have to
-- delete-and-redo a wrongly-created material instead.
--
-- Same one-transaction reasoning as accept_family_proposal (182):
-- PostgREST has no client-side multi-statement transaction API, so
-- creating the colour (if new), inserting the variant, and updating
-- shopvox_materials' migration link all have to happen inside one
-- Postgres function to be atomic -- if anything fails, nothing lands.
--
-- Payload shape (mirrors AddToExistingMaterialInput in
-- migrate/actions.ts):
-- {
--   "organization_id": uuid,
--   "material_id": uuid,               -- the EXISTING material to add to
--   "colour": {
--     "existing_color_id": uuid|null,  -- null = create a new colour/finish
--     "name": text|null,               -- used only when existing_color_id is null
--     "code": text|null,
--     "is_stocked": bool
--   },
--   "variant": {
--     "height": numeric|null, "width": numeric|null,
--     "length_increment": numeric|null,
--     "base_cost": numeric|null, "multiplier": numeric|null,
--     "is_default": bool
--   },
--   "source_row_id": uuid              -- the shopvox_materials row being folded in
-- }
--
-- multiplier: same rule as accept_family_proposal -- material_variants.
-- multiplier is NOT NULL (migration 173), so a missing value FAILS
-- LOUDLY here too, never silently defaults. Never touches base_cost.
--
-- is_default / migration 181's one-default-per-(material, colour)
-- index: if the caller asks for is_default=true on a colour that
-- already has a default variant, this function moves it -- UPDATEs the
-- existing default to false FIRST, in the same transaction, before
-- inserting the new one as the default. If is_default=false (the
-- common case), any existing default is left untouched. This is what
-- "must not also be default unless he explicitly moves it" means in
-- practice: the move only happens when he explicitly asks for it via
-- is_default=true, never as a side effect of just adding a size.

-- ------------------------------------------------------------
-- STATEMENT 1 of 2 -- create the function.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION add_variant_to_existing_material(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id uuid := (payload->>'organization_id')::uuid;
  v_material_id uuid := (payload->>'material_id')::uuid;
  v_colour jsonb := payload->'colour';
  v_variant jsonb := payload->'variant';
  v_source_row_id uuid := (payload->>'source_row_id')::uuid;
  v_material_org_id uuid;
  v_colour_id uuid;
  v_colour_material_id uuid;
  v_is_default boolean;
  v_next_sort_order integer;
  v_new_variant_id uuid;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: organization_id is required';
  END IF;
  IF v_material_id IS NULL THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: material_id is required';
  END IF;
  IF v_source_row_id IS NULL THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: source_row_id is required';
  END IF;

  SELECT organization_id INTO v_material_org_id FROM public.materials WHERE id = v_material_id;
  IF v_material_org_id IS NULL THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: material_id % does not reference an existing material', v_material_id;
  END IF;
  IF v_material_org_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: material_id % belongs to a different organization', v_material_id;
  END IF;

  -- Resolve or create the colour/finish.
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

  -- multiplier: FAIL LOUDLY, same rule and same reason as
  -- accept_family_proposal -- material_variants.multiplier is NOT NULL,
  -- so there is no "leave NULL" option, and inventing a default here
  -- would repeat the exact bug that migration 182 was fixed for.
  IF v_variant->>'multiplier' IS NULL THEN
    RAISE EXCEPTION 'add_variant_to_existing_material: no multiplier available for this variant (%x%) -- refusing to invent one. Every variant must carry its own real multiplier.',
      v_variant->>'height', v_variant->>'width';
  END IF;

  v_is_default := COALESCE((v_variant->>'is_default')::boolean, false);

  -- Move the existing default (if any) only when this variant explicitly
  -- claims to be the new default -- never as a side effect of a plain add.
  IF v_is_default THEN
    UPDATE public.material_variants
       SET is_default = false
     WHERE material_id = v_material_id
       AND color_id IS NOT DISTINCT FROM v_colour_id
       AND is_default = true;
  END IF;

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

  -- migrated_source_hash = source_hash: read fresh, live, at this exact
  -- moment -- same discipline as accept_family_proposal.
  UPDATE public.shopvox_materials
     SET migrated_to_material_id = v_material_id,
         migrated_at = now(),
         migrated_source_hash = source_hash
   WHERE id = v_source_row_id
     AND organization_id = v_org_id;

  RETURN v_new_variant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION add_variant_to_existing_material(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION add_variant_to_existing_material(jsonb) TO service_role;
REVOKE ALL ON FUNCTION add_variant_to_existing_material(jsonb) FROM anon;

-- Verification for statement 1:
-- select proname from pg_proc where proname = 'add_variant_to_existing_material' and pronamespace = 'public'::regnamespace;
-- Expected: one row.
-- select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'add_variant_to_existing_material';
-- Expected: authenticated and service_role rows with EXECUTE, no anon row.

-- ------------------------------------------------------------
-- STATEMENT 2 of 2 -- functional smoke tests.
-- ------------------------------------------------------------
-- -- Setup: a real material with one colour and one default variant.
-- insert into materials (organization_id, name, length_uom, active)
-- values ('4ca12dff-97be-4472-8099-ab102a3af01a', 'RUNBOOK_TEST_PARENT .118in - 1/8"', 'in', true)
-- returning id; -- note the id, call it :parent_id
--
-- insert into material_colors (material_id, name, code) values (:parent_id, 'White', '7328') returning id; -- note as :white_id
-- insert into material_variants (material_id, color_id, height, width, is_default, base_cost, multiplier)
-- values (:parent_id, :white_id, 48, 96, true, 10, 3);
--
-- -- Test A: add a new SIZE to the existing "White" colour, not default -- should succeed, leave the existing default alone.
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colour": {"existing_color_id": "' || :'white_id' || '"},
--   "variant": {"height": 60, "width": 120, "base_cost": 12, "multiplier": 3, "is_default": false},
--   "source_row_id": "00000000-0000-0000-0000-000000000000"
-- }')::jsonb);
-- select height, width, is_default from material_variants where material_id = :'parent_id' and color_id = :'white_id' order by sort_order;
-- Expected: 2 rows -- (48,96,true) unchanged, (60,120,false) new.
--
-- -- Test B: add a new COLOUR "Black", as the default for that new colour -- should succeed, must NOT touch White's default.
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colour": {"existing_color_id": null, "name": "Black", "code": "2025"},
--   "variant": {"height": 48, "width": 96, "base_cost": 9, "multiplier": 3, "is_default": true},
--   "source_row_id": "00000000-0000-0000-0000-000000000000"
-- }')::jsonb);
-- select mc.name, mv.is_default from material_variants mv join material_colors mc on mc.id = mv.color_id where mv.material_id = :'parent_id' order by mc.name;
-- Expected: White row still is_default=true (its own, untouched), Black row is_default=true (its own new colour) -- both true is CORRECT, they're different colours (the unique index from 181 is scoped per colour, not per material).
--
-- -- Test C: no multiplier -- must fail loudly, nothing partial lands.
-- select add_variant_to_existing_material(('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material_id": "' || :'parent_id' || '",
--   "colour": {"existing_color_id": "' || :'white_id' || '"},
--   "variant": {"height": 30, "width": 40, "base_cost": 5, "multiplier": null, "is_default": false},
--   "source_row_id": "00000000-0000-0000-0000-000000000000"
-- }')::jsonb);
-- Expected: ERROR -- "add_variant_to_existing_material: no multiplier available for this variant (30x40)...".
-- select count(*) from material_variants where material_id = :'parent_id' and height = 30;
-- Expected: 0.
--
-- -- Cleanup:
-- delete from materials where id = :'parent_id'; -- cascades to material_colors, material_variants
