ALTER TABLE public.material_variants ADD COLUMN source_name text;

-- ============================================================
-- Migration 189: material_variants.source_name -- per-variant ShopVOX
-- provenance. Applied: PROPOSED, NOT run.
-- ============================================================
--
-- WHY THIS IS URGENT: shopvox_materials.migrated_to_material_id points
-- at a MATERIAL, not a variant. move_variants_to_material (188)
-- relocates variants between materials freely -- that's the entire point
-- of the Family Workbench -- so the moment a variant moves, the
-- material-level link still points at the OLD (now-deactivated) shell,
-- not wherever the variant actually lives now. Confirmed live: querying
-- Trim Cap's ShopVOX ancestors today returns ZERO rows, because its
-- variants were already moved into a new family before this column
-- existed. source_name is per-VARIANT precisely because the material-
-- level link cannot survive a move -- it travels WITH the variant.
--
-- Written once, at the moment a variant is created from a ShopVOX row
-- (accept_family_proposal below, add_variant_to_existing_material
-- below), and NEVER overwritten after that -- see this migration's PR
-- description for confirmation that move_variants_to_material and
-- create_material_family_from_variants (188) never touch it: 188's own
-- UPDATE statement lists material_id, color_id, is_default and nothing
-- else ("every remaining column keeps its existing value untouched,
-- unlisted" -- 188's own comment), so source_name survives a move with
-- zero code changes required here.
--
-- No NOT NULL, no default: a variant created before this column existed
-- (or reconstructed only partially by the backfill -- see the separate
-- backfill script, not a migration, proposed alongside this PR) legally
-- has source_name = NULL. NULL means "we don't know," not "blank" --
-- never populate it with an empty string.
--
-- GRANTS: no new grants needed. The column is covered by
-- material_variants' existing table-level RLS policy and existing
-- SELECT/INSERT/UPDATE grants (migration 173) -- a new column on an
-- already-grants-covered table needs nothing further. Confirmed nothing
-- in this migration grants anon anything: the two GRANT statements below
-- are CREATE OR REPLACE re-declarations of privileges accept_family_
-- proposal and add_variant_to_existing_material already had (to
-- authenticated and service_role only), and both REVOKE blocks are
-- unchanged from their prior migrations (187 for the PUBLIC+anon revoke
-- shape on accept_family_proposal; 186 for the anon-only revoke already
-- established on add_variant_to_existing_material, not widened here).

-- ------------------------------------------------------------
-- STATEMENT 2 of 3 -- accept_family_proposal: write source_name at
-- creation time. CREATE OR REPLACE against 187's body (the current live
-- one) -- nothing else changed, including its PUBLIC+anon revoke shape.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION accept_family_proposal(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id uuid := (payload->>'organization_id')::uuid;
  v_material jsonb := payload->'material';
  v_vendor jsonb := payload->'vendor_seed';
  v_new_material_id uuid;
  v_colour jsonb;
  v_colour_id uuid;
  v_variant jsonb;
BEGIN
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'accept_family_proposal: organization_id is required';
  END IF;
  IF v_material IS NULL OR v_material->>'name' IS NULL OR trim(v_material->>'name') = '' THEN
    RAISE EXCEPTION 'accept_family_proposal: material.name is required';
  END IF;
  IF jsonb_array_length(COALESCE(payload->'colours', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'accept_family_proposal: at least one colour group (variants list) is required';
  END IF;

  IF v_material->>'multiplier' IS NOT NULL AND (v_material->>'multiplier')::numeric = 0 THEN
    RAISE EXCEPTION 'accept_family_proposal: material "%" has multiplier = 0 -- refusing to invent one (a multiplier of 0 is treated as missing, same as NULL). Leave it unset if truly unknown, or provide the real multiplier.',
      v_material->>'name';
  END IF;

  INSERT INTO public.materials (
    organization_id, name, material_type_id, category_id, length_uom,
    cost, price, sheet_cost, multiplier, weight,
    part_number, sku, po_description, info_url, description, preferred_vendor,
    active
  ) VALUES (
    v_org_id,
    v_material->>'name',
    NULLIF(v_material->>'material_type_id', '')::uuid,
    NULLIF(v_material->>'category_id', '')::uuid,
    COALESCE(v_material->>'length_uom', 'in'),
    (v_material->>'cost')::numeric,
    (v_material->>'price')::numeric,
    (v_material->>'sheet_cost')::numeric,
    (v_material->>'multiplier')::numeric,
    (v_material->>'weight')::numeric,
    v_material->>'part_number',
    v_material->>'sku',
    v_material->>'po_description',
    v_material->>'info_url',
    v_material->>'description',
    v_material->>'preferred_vendor',
    true
  )
  RETURNING id INTO v_new_material_id;

  FOR v_colour IN SELECT * FROM jsonb_array_elements(payload->'colours')
  LOOP
    IF v_colour->>'name' IS NOT NULL AND trim(v_colour->>'name') <> '' THEN
      INSERT INTO public.material_colors (material_id, name, code, is_stocked)
      VALUES (v_new_material_id, v_colour->>'name', v_colour->>'code', COALESCE((v_colour->>'is_stocked')::boolean, false))
      RETURNING id INTO v_colour_id;
    ELSE
      v_colour_id := NULL;
    END IF;

    IF jsonb_array_length(COALESCE(v_colour->'variants', '[]'::jsonb)) = 0 THEN
      RAISE EXCEPTION 'accept_family_proposal: colour "%" has no size variants', COALESCE(v_colour->>'name', '(none)');
    END IF;

    FOR v_variant IN SELECT * FROM jsonb_array_elements(v_colour->'variants')
    LOOP
      IF v_variant->>'multiplier' IS NULL OR (v_variant->>'multiplier')::numeric = 0 THEN
        RAISE EXCEPTION 'accept_family_proposal: no usable multiplier for a "%" variant (%x%) -- refusing to invent one (a multiplier of 0 is treated as missing, same as NULL). Every variant must carry its own real multiplier.',
          COALESCE(v_colour->>'name', '(no colour/finish)'), v_variant->>'height', v_variant->>'width';
      END IF;

      -- NEW 189: source_name -- the ShopVOX row name this variant came
      -- from. Written once, here, at creation. Never touched again by
      -- move_variants_to_material or create_material_family_from_variants
      -- (188) -- see this migration's header comment.
      INSERT INTO public.material_variants (
        material_id, color_id, height, width, length_increment,
        is_default, base_cost, multiplier, sort_order, source_name
      ) VALUES (
        v_new_material_id, v_colour_id,
        (v_variant->>'height')::numeric,
        (v_variant->>'width')::numeric,
        (v_variant->>'length_increment')::numeric,
        COALESCE((v_variant->>'is_default')::boolean, false),
        (v_variant->>'base_cost')::numeric,
        (v_variant->>'multiplier')::numeric,
        COALESCE((v_variant->>'sort_order')::integer, 0),
        NULLIF(v_variant->>'source_name', '')
      );
    END LOOP;
  END LOOP;

  IF v_vendor IS NOT NULL AND v_vendor->>'vendor_name' IS NOT NULL THEN
    INSERT INTO public.material_vendors (
      organization_id, material_id, vendor_name, vendor_price, part_number, rank,
      buying_units, is_preferred, po_description
    ) VALUES (
      v_org_id, v_new_material_id, v_vendor->>'vendor_name',
      (v_vendor->>'vendor_price')::numeric, v_vendor->>'part_number',
      (v_vendor->>'rank')::integer, 'Sheet', true, v_vendor->>'po_description'
    );
  END IF;

  UPDATE public.shopvox_materials
     SET migrated_to_material_id = v_new_material_id,
         migrated_at = now(),
         migrated_source_hash = source_hash
   WHERE id IN (SELECT (jsonb_array_elements_text(payload->'source_row_ids'))::uuid)
     AND organization_id = v_org_id;

  RETURN v_new_material_id;
END;
$$;

GRANT EXECUTE ON FUNCTION accept_family_proposal(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_family_proposal(jsonb) TO service_role;
REVOKE ALL ON FUNCTION accept_family_proposal(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_family_proposal(jsonb) FROM anon;

-- Verification for statement 2:
-- select proname from pg_proc where proname = 'accept_family_proposal' and pronamespace = 'public'::regnamespace;
-- Expected: one row (CREATE OR REPLACE keeps the same function identity).
-- select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'accept_family_proposal';
-- Expected: authenticated and service_role rows with EXECUTE. No anon row, no PUBLIC row.

-- ------------------------------------------------------------
-- STATEMENT 3 of 3 -- add_variant_to_existing_material: write
-- source_name at creation time. CREATE OR REPLACE against 186's body
-- (the current live one, with the no_colour_finish target).
--
-- CORRECTED after this migration was already run: the REVOKE ALL ...
-- FROM PUBLIC line below was originally omitted here (left as 186's
-- anon-only revoke, treating the PUBLIC gap 187's header comment flags
-- as a separate, out-of-scope decision for this function). That was
-- wrong to leave out, not just incomplete: functions GRANT EXECUTE TO
-- PUBLIC by default, anon is a member of PUBLIC, so an anon-only revoke
-- never actually removed anon's access -- CREATE OR REPLACE preserved
-- that gap through this migration same as it did through 185/186. Ruben
-- ran the missing REVOKE by hand in the SQL editor; the line below
-- brings the file back in sync with what is actually live.
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

      IF v_variant->>'multiplier' IS NULL OR (v_variant->>'multiplier')::numeric = 0 THEN
        RAISE EXCEPTION 'add_variant_to_existing_material: no usable multiplier for a "%" variant (%x%) -- refusing to invent one (a multiplier of 0 is treated as missing, same as NULL). Every variant must carry its own real multiplier.',
          COALESCE(v_colour->>'name', '(no colour/finish)'), v_variant->>'height', v_variant->>'width';
      END IF;

      v_is_default := COALESCE((v_variant->>'is_default')::boolean, false);

      SELECT COALESCE(MAX(sort_order) + 1, 0) INTO v_next_sort_order
        FROM public.material_variants
       WHERE material_id = v_material_id
         AND color_id IS NOT DISTINCT FROM v_colour_id;

      -- NEW 189: source_name -- same rule as accept_family_proposal
      -- above. Written once, here, at creation; never touched again by a
      -- later move.
      INSERT INTO public.material_variants (
        material_id, color_id, height, width, length_increment,
        is_default, base_cost, multiplier, sort_order, source_name
      ) VALUES (
        v_material_id, v_colour_id,
        (v_variant->>'height')::numeric,
        (v_variant->>'width')::numeric,
        (v_variant->>'length_increment')::numeric,
        v_is_default,
        (v_variant->>'base_cost')::numeric,
        (v_variant->>'multiplier')::numeric,
        v_next_sort_order,
        NULLIF(v_variant->>'source_name', '')
      )
      RETURNING id INTO v_new_variant_id;

      v_source_row_ids := array_append(v_source_row_ids, v_source_row_id);
    END LOOP;
  END LOOP;

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
REVOKE ALL ON FUNCTION add_variant_to_existing_material(jsonb) FROM PUBLIC;

-- Verification for statement 3:
-- select proname from pg_proc where proname = 'add_variant_to_existing_material' and pronamespace = 'public'::regnamespace;
-- Expected: one row (CREATE OR REPLACE keeps the same function identity).
-- select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'add_variant_to_existing_material';
-- Expected: authenticated and service_role rows with EXECUTE. No anon row, no PUBLIC row.

-- ------------------------------------------------------------
-- Functional smoke tests, statements 2 and 3.
-- ------------------------------------------------------------
-- -- Test A: accept_family_proposal writes source_name per variant.
-- select accept_family_proposal('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material": {"name": "RUNBOOK_TEST_SOURCE_NAME .118in - 1/8\"", "length_uom": "in", "multiplier": 2},
--   "colours": [
--     {"name": "White", "variants": [
--       {"height": 48, "width": 96, "is_default": true, "base_cost": 10, "multiplier": 2, "source_name": "Acrylic White (7328) .118in - 1/8\" 4ft x 8ft"}
--     ]}
--   ],
--   "vendor_seed": null,
--   "source_row_ids": []
-- }'::jsonb);
-- select mv.source_name from material_variants mv join materials m on m.id = mv.material_id where m.name = 'RUNBOOK_TEST_SOURCE_NAME .118in - 1/8"';
-- Expected: one row, source_name = 'Acrylic White (7328) .118in - 1/8" 4ft x 8ft'.
-- delete from materials where name = 'RUNBOOK_TEST_SOURCE_NAME .118in - 1/8"';
--
-- -- Test B: a move preserves source_name untouched (proves the claim in
-- -- this migration's PR description, not just the code-reading argument).
-- insert into materials (organization_id, name, length_uom, active) values
--   ('4ca12dff-97be-4472-8099-ab102a3af01a', 'RUNBOOK_TEST_MOVE_SOURCE', 'in', true) returning id; -- note as :target_id
-- insert into material_variants (material_id, height, width, multiplier, source_name)
--   values ((select id from materials where name = 'RUNBOOK_TEST_MOVE_SOURCE'), 48, 96, 2, 'Original ShopVOX Name Here')
--   returning id; -- note as :variant_id
-- insert into materials (organization_id, name, length_uom, active) values
--   ('4ca12dff-97be-4472-8099-ab102a3af01a', 'RUNBOOK_TEST_MOVE_TARGET', 'in', true) returning id; -- note as :other_target_id
-- select move_variants_to_material(ARRAY[:'variant_id']::uuid[], :'other_target_id');
-- select source_name, material_id from material_variants where id = :'variant_id';
-- Expected: source_name unchanged ('Original ShopVOX Name Here'), material_id now :other_target_id.
-- delete from materials where name in ('RUNBOOK_TEST_MOVE_SOURCE', 'RUNBOOK_TEST_MOVE_TARGET');
