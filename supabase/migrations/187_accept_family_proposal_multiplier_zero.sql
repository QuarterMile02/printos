-- ============================================================
-- Migration 187: accept_family_proposal -- close the multiplier = 0 gap.
-- Applied: PROPOSED, NOT run. 182 is already applied live (confirmed:
-- it has migrated ~1,700 rows correctly). This CREATE OR REPLACEs the
-- same function again, same pattern 185 used against 183 and 186 used
-- against 185 -- 182's file is NOT edited.
-- ============================================================
--
-- THE BUG, confirmed live: "Roodle" was accepted through "Accept as new
-- material" and landed with multiplier = 0 on BOTH the material and its
-- one variant -- a real, non-error $0.00 sell price, no exception
-- raised. 182's multiplier check only tested `IS NULL`:
--   IF v_variant->>'multiplier' IS NULL THEN RAISE EXCEPTION ...
-- A multiplier of 0 sailed straight through. Migrations 185 and 186
-- already added "0 is treated exactly like NULL" to
-- add_variant_to_existing_material -- but that guard was never
-- retrofitted into accept_family_proposal, which is the MAIN accept
-- path (every "Accept as new material" click). One door had the guard,
-- the other didn't.
--
-- Read 182 in full first (this file's body below is 182's, unmodified,
-- except the two new checks marked "NEW 187" in their own comments) and
-- 186 for the exact wording already established. Mirrored here, not
-- reinvented -- same "a multiplier of 0 is treated as missing, same as
-- NULL" phrasing, same RAISE EXCEPTION shape naming the colour and the
-- size for the variant-level check.
--
-- TWO new checks, nothing else changed:
--   1. Variant-level (extends the existing check): `multiplier IS NULL
--      OR multiplier = 0` now both raise, matching 186 exactly.
--   2. Material-level (NEW, 182 never had ANY multiplier check here):
--      `materials.multiplier` is nullable (migration 010, no NOT NULL
--      ever added) and leaving it NULL when truly unknown stays legal
--      and UNCHANGED by this migration -- 182's own header comment
--      already established that as deliberate, and this migration does
--      not touch it. What's new is narrower: if the payload EXPLICITLY
--      carries a material-level multiplier of exactly 0, that is
--      refused too, for the same reason as the variant check -- 0 is
--      not a real multiplier, it's a placeholder that produces a real,
--      silently-wrong $0 read on the legacy pricing engine
--      (`materials.multiplier` is what that engine still reads, per
--      182's own header comment). NULL was never the problem; 0
--      pretending to be a real number is.
--
-- BLAST RADIUS, checked live, not estimated: querying materials with
-- multiplier = 0 today returns 44 rows org-wide, but 41 of those are
-- pre-existing legacy materials the original ShopVOX scrape wrote
-- directly into `materials` (confirmed: no shopvox_materials row has
-- migrated_to_material_id pointing at them) -- accept_family_proposal
-- was never involved in creating them, so this migration cannot affect
-- them in any way, retroactively or otherwise. Exactly 3 of the 44 were
-- actually created by accept_family_proposal (confirmed via
-- shopvox_materials.migrated_to_material_id, status = 'MIGRATED'):
--
--   materials.id                          | name        | source shopvox_materials row
--   08c23699-29a6-47f2-bbd3-70807dee6b85   | Roodle      | Roodle Matte White Removable 54" x 100"
--   8d8e5adf-0d3a-49b1-89af-a4c9b4697363   | Trimp Cap   | Bronze 313 / Trimp Cap
--   7e432e0c-02c2-4c83-b16a-d270a1f94d04   | Trimp Cap   | Teal / Trimp Cap
--
-- All 3 have BOTH their material-level multiplier AND their one
-- variant's multiplier at exactly 0 -- confirmed by cross-referencing
-- material_variants (org-wide, only 3 rows total have multiplier = 0,
-- and they are these same 3 materials' own variants). No case exists,
-- live, of a material with a real material-level multiplier hiding a
-- zero-multiplier variant, or vice versa.
--
-- THIS MIGRATION CANNOT AFFECT ANY ALREADY-MIGRATED ROW, including
-- these 3. A `CREATE OR REPLACE FUNCTION` changes what happens the NEXT
-- time the function is CALLED -- it does not re-run against, re-
-- validate, or touch any row already written by a previous call. Those
-- 3 materials keep existing, keep their $0 sell price, exactly as they
-- are today, until someone explicitly edits them (or migrates a
-- replacement and dismisses/deletes them) -- that is a separate,
-- manual cleanup decision, not something this migration does or
-- should do silently.
--
-- GRANTS: this migration also adds an explicit
-- `REVOKE ALL ... FROM PUBLIC`. 185 and 186 (add_variant_to_existing_
-- material) and 182 itself shipped with only `REVOKE ALL ... FROM
-- anon` -- correctly flagged as a theoretical gap: revoking from a
-- specific role does not remove access that role would otherwise have
-- via an EXECUTE grant to PUBLIC (every role implicitly has whatever
-- PUBLIC has, regardless of direct grants/revokes to that role
-- specifically). Checked live, not assumed: called both
-- accept_family_proposal and add_variant_to_existing_material with the
-- project's own anon key just now -- both returned
-- `permission denied for function ... (42501)`, proving anon has NO
-- access today, on either function. So this is not an active
-- vulnerability right now (most likely because Supabase's own default
-- schema privileges already revoke PUBLIC execute on newly created
-- `public`-schema functions, which is Supabase's documented default,
-- not something this project configured) -- but that is an inference
-- from a platform default, not a guarantee this migration should rely
-- on. The explicit `REVOKE ALL ... FROM PUBLIC` below costs nothing,
-- removes the dependency on that default holding, and documents the
-- intended posture directly in the migration instead of leaving it
-- implicit. `add_variant_to_existing_material` (185/186) has the same
-- theoretical gap and the same live-tested current safety -- not
-- touched by this migration, flagged here for a separate decision
-- since this migration's scope is accept_family_proposal only.
--
-- NOTHING ELSE IN 182 IS CHANGED. Every other check, every INSERT,
-- the vendor_seed handling, the final shopvox_materials UPDATE -- all
-- byte-identical to 182's already-applied, already-proven-on-~1,700-
-- rows body.

-- ------------------------------------------------------------
-- STATEMENT 1 of 2 -- replace the function.
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

  -- NEW 187: material-level multiplier = 0 is refused, exactly like a
  -- zero variant multiplier -- NULL stays legal and unchanged (see
  -- header comment; materials.multiplier is nullable, migration 010,
  -- no NOT NULL ever added -- this does not add one).
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
    (v_material->>'multiplier')::numeric, -- no COALESCE(...,2): materials.multiplier is nullable (no NOT NULL anywhere on it), so an unknown value is left NULL, honestly, rather than invented -- see header comment
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
      -- material_variants.multiplier is NOT NULL (migration 173) -- a
      -- missing value here can't just be "left NULL" the way materials.
      -- multiplier above can. FAIL LOUDLY instead of COALESCE-ing to a
      -- default: a confirmed real accept previously produced
      -- multiplier=2.0000 on every variant of a 7-variant family whose
      -- real multipliers were 3 and 3.77 -- a silently invented number
      -- that priced without complaint. Same failure shape as the
      -- tax-rate incident this mirrors. Raising here also gives a much
      -- clearer error than the raw "null value in column multiplier
      -- violates not-null constraint" Postgres would throw anyway if
      -- this check were skipped and the INSERT just failed on its own.
      --
      -- EXTENDED 187, mirroring 186's add_variant_to_existing_material
      -- wording exactly: a multiplier of 0 is now ALSO treated as
      -- missing, refused, never defaulted -- confirmed live this gap
      -- let "Roodle" (and two "Trimp Cap" materials) land with
      -- multiplier = 0 and a real, non-error $0.00 sell price. See this
      -- migration's header comment for the full blast-radius check.
      IF v_variant->>'multiplier' IS NULL OR (v_variant->>'multiplier')::numeric = 0 THEN
        RAISE EXCEPTION 'accept_family_proposal: no usable multiplier for a "%" variant (%x%) -- refusing to invent one (a multiplier of 0 is treated as missing, same as NULL). Every variant must carry its own real multiplier.',
          COALESCE(v_colour->>'name', '(no colour/finish)'), v_variant->>'height', v_variant->>'width';
      END IF;

      INSERT INTO public.material_variants (
        material_id, color_id, height, width, length_increment,
        is_default, base_cost, multiplier, sort_order
      ) VALUES (
        v_new_material_id, v_colour_id,
        (v_variant->>'height')::numeric,
        (v_variant->>'width')::numeric,
        (v_variant->>'length_increment')::numeric,
        COALESCE((v_variant->>'is_default')::boolean, false),
        (v_variant->>'base_cost')::numeric,
        (v_variant->>'multiplier')::numeric,
        COALESCE((v_variant->>'sort_order')::integer, 0)
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

  -- migrated_source_hash = source_hash: read fresh, live, at this exact
  -- moment -- see header comment.
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
-- NEW 187: explicit PUBLIC revoke, in addition to the anon revoke below
-- -- see header comment. REVOKE FROM PUBLIC first so the anon-specific
-- revoke that follows reads as the intentional, explicit belt-and-
-- suspenders documentation it is, not as the only thing doing the work.
REVOKE ALL ON FUNCTION accept_family_proposal(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_family_proposal(jsonb) FROM anon;

-- Verification for statement 1:
-- select proname from pg_proc where proname = 'accept_family_proposal' and pronamespace = 'public'::regnamespace;
-- Expected: one row (CREATE OR REPLACE keeps the same function identity).
-- select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'accept_family_proposal';
-- Expected: authenticated and service_role rows with EXECUTE. No anon row, no PUBLIC row.

-- ------------------------------------------------------------
-- STATEMENT 2 of 2 -- functional smoke tests.
-- ------------------------------------------------------------
-- -- Test A: variant multiplier = 0 -- must fail loudly, exactly like
-- -- NULL, and must not leave ANY partial material behind.
-- select accept_family_proposal('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material": {"name": "RUNBOOK_TEST_VARIANT_ZERO", "length_uom": "in", "multiplier": 3},
--   "colours": [
--     {"name": "White", "variants": [
--       {"height": 48, "width": 96, "is_default": true, "base_cost": 10, "multiplier": 0}
--     ]}
--   ],
--   "vendor_seed": null,
--   "source_row_ids": []
-- }'::jsonb);
-- Expected: ERROR -- "accept_family_proposal: no usable multiplier for a "White" variant (48x96) -- refusing to invent one (a multiplier of 0 is treated as missing, same as NULL)...".
-- select count(*) from materials where name = 'RUNBOOK_TEST_VARIANT_ZERO';
-- Expected: 0 -- nothing partial landed, same as the existing NULL-multiplier test in 182.
--
-- -- Test B: material-level multiplier = 0 (NEW in this migration) --
-- -- must fail loudly before any INSERT, even though the variant's own
-- -- multiplier is real.
-- select accept_family_proposal('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material": {"name": "RUNBOOK_TEST_MATERIAL_ZERO", "length_uom": "in", "multiplier": 0},
--   "colours": [
--     {"name": "White", "variants": [
--       {"height": 48, "width": 96, "is_default": true, "base_cost": 10, "multiplier": 3}
--     ]}
--   ],
--   "vendor_seed": null,
--   "source_row_ids": []
-- }'::jsonb);
-- Expected: ERROR -- "accept_family_proposal: material "RUNBOOK_TEST_MATERIAL_ZERO" has multiplier = 0 -- refusing to invent one...".
-- select count(*) from materials where name = 'RUNBOOK_TEST_MATERIAL_ZERO';
-- Expected: 0.
--
-- -- Test C: material-level multiplier = NULL (omitted) -- must still
-- -- succeed. Proves the existing "NULL is legal at material level" rule
-- -- is genuinely unchanged, not accidentally tightened.
-- select accept_family_proposal('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material": {"name": "RUNBOOK_TEST_MATERIAL_NULL_OK", "length_uom": "in"},
--   "colours": [
--     {"name": "White", "variants": [
--       {"height": 48, "width": 96, "is_default": true, "base_cost": 10, "multiplier": 3}
--     ]}
--   ],
--   "vendor_seed": null,
--   "source_row_ids": []
-- }'::jsonb);
-- Expected: succeeds, returns a uuid.
-- select multiplier from materials where name = 'RUNBOOK_TEST_MATERIAL_NULL_OK';
-- Expected: one row, multiplier = NULL.
--
-- -- Test D: a completely normal accept, both multipliers real -- must
-- -- still succeed exactly as it did under 182, unchanged behavior.
-- select accept_family_proposal('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material": {"name": "RUNBOOK_TEST_NORMAL", "length_uom": "in", "cost": 10, "price": 20, "multiplier": 2},
--   "colours": [
--     {"name": "White", "code": "7328", "is_stocked": true, "variants": [
--       {"height": 48, "width": 96, "is_default": true, "base_cost": 10, "multiplier": 2}
--     ]}
--   ],
--   "vendor_seed": null,
--   "source_row_ids": []
-- }'::jsonb);
-- Expected: succeeds, returns a uuid.
--
-- -- Cleanup:
-- delete from materials where name in ('RUNBOOK_TEST_MATERIAL_NULL_OK', 'RUNBOOK_TEST_NORMAL');
-- Expected: 2 rows deleted (cascades to material_colors, material_variants). Tests A and B never landed anything to clean up.
