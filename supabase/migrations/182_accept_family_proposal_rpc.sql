-- ============================================================
-- Migration 182: accept_family_proposal RPC -- Build 1b item 2.
-- Applied: PROPOSED, NOT run. Requires 173 (material_variants), 174
-- (material_colors), 175 (material_vendors routing fields), 179
-- (shopvox_materials), and 181 (material_variants.color_id) already live.
-- ============================================================
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
    COALESCE((v_material->>'multiplier')::numeric, 2),
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
        COALESCE((v_variant->>'multiplier')::numeric, 2),
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
-- STATEMENT 2 of 2 -- functional smoke test: accept a tiny 2-colour,
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
