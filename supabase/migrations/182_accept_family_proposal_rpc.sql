-- ============================================================
-- Migration 182: accept_family_proposal RPC -- Build 1b item 2.
-- Applied: PROPOSED, NOT run. Requires 173 (material_variants), 174
-- (material_colors), 175 (material_vendors routing fields), 179
-- (shopvox_materials), and 181 (material_variants.color_id) already live.
-- ============================================================
--
-- FIXED 2026-08-21, before this was ever run: caught on Ruben's first
-- real accept (the one material created was unwound, its 7 source rows
-- reset to NEW, before this fix landed). The bug was upstream of this
-- function, not in it -- migrate-client.tsx's handleAccept hardcoded
-- `baseCost: null, multiplier: null` on every variant instead of
-- looking up each variant's own source row, and this function then
-- COALESCE-d the resulting nulls to a multiplier of 2 for every
-- variant, silently, regardless of what the real per-row multipliers
-- actually were (confirmed: 3, except one at 3.77). Two things fixed:
-- (1) the real bug, upstream, in migrate-client.tsx -- out of scope for
-- this file; (2) the COALESCE(...,2) here, which masked that upstream
-- bug by inventing a plausible-looking number instead of failing. Both
-- COALESCE(...,2) calls below are removed -- see each site for which of
-- "leave NULL" or "fail loudly" applies, decided by whether the target
-- column is nullable (checked live/against every migration touching it,
-- not assumed):
--   - materials.multiplier: nullable (numeric(8,4) DEFAULT 2.0 from
--     migration 010, no NOT NULL ever added anywhere) -- leaving it
--     NULL when unknown is a legal, honest DB state.
--   - material_variants.multiplier: NOT NULL (migration 173,
--     `numeric(10,4) NOT NULL DEFAULT 1`) -- "leave NULL" isn't
--     possible here without the INSERT itself erroring, so this
--     function now RAISES explicitly and clearly when a variant's
--     multiplier is missing, rather than letting a generic not-null
--     constraint violation (or, worse, a silently invented default)
--     stand in for it.
--
-- "acceptSubstrateProposal creates material_colors rows and sets
-- material_variants.color_id, in one transaction with the rest" --
-- Supabase/PostgREST has no client-side multi-statement transaction
-- API. The only way to get true atomicity across materials +
-- material_colors + material_variants + material_vendors +
-- shopvox_materials in one go is a single Postgres function -- a
-- function body IS one transaction for the whole call, so every insert
-- below either all lands or (on any error, e.g. the one-default-per-
-- colour unique index from 181 firing) all rolls back together. No
-- partial-accept state is reachable.
--
-- migrated_source_hash "read fresh at accept time": the final UPDATE
-- sets migrated_source_hash = source_hash -- a same-row column
-- reference evaluated by Postgres against the live on-disk value at the
-- moment this statement runs, not a value threaded in from the client
-- request. This is what makes a LATER re-scrape correctly flip a row to
-- CHANGED if it drifts, instead of leaving it stuck at MIGRATED.
--
-- Payload shape (see src/app/(dashboard)/dashboard/[slug]/settings/
-- materials/migrate/actions.ts for the exact TS type this mirrors):
-- {
--   "organization_id": uuid,
--   "material": { name, material_type_id, category_id, length_uom,
--                 cost, price, sheet_cost, multiplier, weight,
--                 part_number, sku, po_description, info_url,
--                 description, preferred_vendor },
--   "colours": [
--     { "name": text|null, "code": text|null, "is_stocked": bool,
--       "variants": [ { height, width, length_increment, is_default,
--                       base_cost, multiplier, sort_order } ] }
--   ],
--   "vendor_seed": { vendor_name, vendor_price, part_number, rank,
--                    po_description } | null,
--   "source_row_ids": [uuid, ...]
-- }
--
-- A colour entry with name = null means "no colour/finish for this
-- group of variants" -- its variants get color_id = NULL directly, no
-- material_colors row created, matching migration 181's NULL
-- convention exactly ("this size applies to the material regardless of
-- colour").

-- ------------------------------------------------------------
-- STATEMENT 1 of 2 -- create the function.
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
      IF v_variant->>'multiplier' IS NULL THEN
        RAISE EXCEPTION 'accept_family_proposal: no multiplier available for a "%" variant (%x%) -- refusing to invent one. Every variant must carry its own real multiplier.',
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
REVOKE ALL ON FUNCTION accept_family_proposal(jsonb) FROM anon;

-- Verification for statement 1:
-- select proname from pg_proc where proname = 'accept_family_proposal' and pronamespace = 'public'::regnamespace;
-- Expected: one row.
-- select grantee, privilege_type from information_schema.role_routine_grants where routine_name = 'accept_family_proposal';
-- Expected: authenticated and service_role rows with EXECUTE, no anon row.

-- ------------------------------------------------------------
-- STATEMENT 2 of 3 -- functional smoke test: accept a tiny 2-colour,
-- 3-variant proposal, confirm the material/colours/variants/vendor
-- landed and are linked correctly, then delete the test material
-- (cascades to its variants/colours/vendor rows).
-- ------------------------------------------------------------
-- select accept_family_proposal('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material": {"name": "RUNBOOK_TEST_FAMILY .118in - 1/8\"", "length_uom": "in", "cost": 10, "price": 20, "multiplier": 2},
--   "colours": [
--     {"name": "White", "code": "7328", "is_stocked": true, "variants": [
--       {"height": 48, "width": 96, "is_default": true, "base_cost": 10, "multiplier": 2}
--     ]},
--     {"name": null, "variants": [
--       {"height": 60, "width": 120, "is_default": true, "base_cost": 15, "multiplier": 2}
--     ]}
--   ],
--   "vendor_seed": {"vendor_name": "Test Vendor", "vendor_price": 10, "rank": 1},
--   "source_row_ids": []
-- }'::jsonb);
--
-- select m.name, mc.name as colour, mv.height, mv.width, mv.color_id, mv.is_default
-- from materials m
-- join material_variants mv on mv.material_id = m.id
-- left join material_colors mc on mc.id = mv.color_id
-- where m.name = 'RUNBOOK_TEST_FAMILY .118in - 1/8"'
-- order by mc.name nulls last;
-- Expected: 2 rows -- one with colour='White', color_id set; one with colour=null, color_id null.
--
-- select vendor_name, is_preferred from material_vendors where material_id = (select id from materials where name = 'RUNBOOK_TEST_FAMILY .118in - 1/8"');
-- Expected: one row, "Test Vendor", is_preferred=true.
--
-- delete from materials where name = 'RUNBOOK_TEST_FAMILY .118in - 1/8"';
-- Expected: cascades to material_colors, material_variants, material_vendors for that material (all FK ON DELETE CASCADE).

-- ------------------------------------------------------------
-- STATEMENT 3 of 3 -- functional smoke test: a variant with NO
-- multiplier must fail loudly, and must not leave ANY partial material
-- behind (proves the one-transaction rollback actually rolls back, not
-- just that the check fires).
-- ------------------------------------------------------------
-- select accept_family_proposal('{
--   "organization_id": "4ca12dff-97be-4472-8099-ab102a3af01a",
--   "material": {"name": "RUNBOOK_TEST_FAIL_LOUD .118in - 1/8\"", "length_uom": "in"},
--   "colours": [
--     {"name": "White", "variants": [
--       {"height": 48, "width": 96, "is_default": true, "base_cost": 10, "multiplier": null}
--     ]}
--   ],
--   "vendor_seed": null,
--   "source_row_ids": []
-- }'::jsonb);
-- Expected: ERROR -- "accept_family_proposal: no multiplier available for a "White" variant (48x96) -- refusing to invent one...".
--
-- select count(*) from materials where name = 'RUNBOOK_TEST_FAIL_LOUD .118in - 1/8"';
-- Expected: 0 -- the failed variant insert rolled back the material insert too, nothing partial landed.
