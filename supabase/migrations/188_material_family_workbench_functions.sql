CREATE OR REPLACE FUNCTION move_variants_to_material(p_variant_ids uuid[], p_target_material_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_target_org_id uuid;
  v_variant_id uuid;
  v_variant record;
  v_source_color_name text;
  v_source_color_code text;
  v_source_color_stocked boolean;
  v_target_color_id uuid;
  v_touched_materials uuid[] := '{}';
  v_source_material_id uuid;
BEGIN
  -- Moves a batch of material_variants rows onto a different material, in
  -- one transaction (the whole function body is one implicit transaction,
  -- so a failure on variant 40 of 50 rolls back all 39 that already moved
  -- -- there is no partial-move state this function can leave behind).
  --
  -- Colour is remapped BY NAME into the target material -- if the target
  -- already has a material_colors row with the same name, reuse it; if
  -- not, create one, copying code/is_stocked from the source colour so
  -- nothing is silently dropped. A variant with color_id NULL stays NULL
  -- -- this mirrors accept_family_proposal's (182) own colour-less
  -- convention exactly: a colourless variant never gets a material_colors
  -- row invented for it just because it moved.
  --
  -- A moved variant that was is_default=true claims the target bucket's
  -- default flag, clearing whatever was there first -- same pattern
  -- add_variant_to_existing_material (186) already uses. This can never
  -- leave two is_default=true rows in one (material, colour) bucket:
  -- idx_material_variants_one_default_per_color (migration 181) would
  -- reject that outright, and the explicit clear here prevents ever
  -- hitting that constraint. If two variants moved in the same call both
  -- claim the same target (material, colour) bucket's default, the one
  -- processed later in p_variant_ids wins -- deterministic, not an error.
  --
  -- A source material left with zero variants is DEACTIVATED, never
  -- deleted -- material_vendors.material_id is ON DELETE CASCADE
  -- (confirmed live, 010_product_builder_FIXED.sql:123) and a delete
  -- would silently take that material's vendor pricing history with it.
  --
  -- SECURITY INVOKER (the default -- no SECURITY DEFINER clause here on
  -- purpose): materials/material_variants/material_colors all carry an
  -- "org members can manage" RLS policy already (migrations 173/174), so
  -- running as the calling user means every SELECT/UPDATE/INSERT below is
  -- already org-scoped by Postgres itself, not by anything this function
  -- has to get right on its own. The explicit organization_id comparison
  -- below exists for a DIFFERENT reason RLS can't cover: a user who is a
  -- genuine member of more than one organization could otherwise pick a
  -- variant from org A and a target material from org B, both
  -- individually visible to them under RLS, and move data between two
  -- orgs they belong to -- this check refuses that regardless of RLS.

  IF p_variant_ids IS NULL OR array_length(p_variant_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'move_variants_to_material: no variant ids provided';
  END IF;

  SELECT organization_id INTO v_target_org_id FROM public.materials WHERE id = p_target_material_id;
  IF v_target_org_id IS NULL THEN
    RAISE EXCEPTION 'move_variants_to_material: target material % does not exist', p_target_material_id;
  END IF;

  FOREACH v_variant_id IN ARRAY p_variant_ids LOOP
    SELECT id, material_id, color_id, organization_id, is_default
      INTO v_variant
      FROM public.material_variants
     WHERE id = v_variant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'move_variants_to_material: variant % does not exist', v_variant_id;
    END IF;

    IF v_variant.organization_id IS DISTINCT FROM v_target_org_id THEN
      RAISE EXCEPTION 'move_variants_to_material: variant % belongs to a different organization than target material %', v_variant_id, p_target_material_id;
    END IF;

    IF v_variant.color_id IS NULL THEN
      v_target_color_id := NULL;
    ELSE
      SELECT name, code, is_stocked
        INTO v_source_color_name, v_source_color_code, v_source_color_stocked
        FROM public.material_colors
       WHERE id = v_variant.color_id;

      SELECT id INTO v_target_color_id
        FROM public.material_colors
       WHERE material_id = p_target_material_id
         AND name = v_source_color_name
       LIMIT 1;

      IF v_target_color_id IS NULL THEN
        INSERT INTO public.material_colors (material_id, name, code, is_stocked)
        VALUES (p_target_material_id, v_source_color_name, v_source_color_code, COALESCE(v_source_color_stocked, false))
        RETURNING id INTO v_target_color_id;
      END IF;
    END IF;

    IF v_variant.is_default THEN
      UPDATE public.material_variants
         SET is_default = false
       WHERE material_id = p_target_material_id
         AND color_id IS NOT DISTINCT FROM v_target_color_id
         AND is_default = true;
    END IF;

    v_source_material_id := v_variant.material_id;

    -- material_id and color_id MUST be set together in this one UPDATE:
    -- validate_material_variant_color_trigger (181) fires on UPDATE OF
    -- color_id OR material_id and requires NEW.color_id's owning material
    -- to equal NEW.material_id at all times -- setting material_id alone
    -- first would fail that check against the OLD color_id every time a
    -- variant with a real colour moves. organization_id and length_uom
    -- are NOT set here -- sync_material_variant_before_write (173) is a
    -- BEFORE UPDATE OF material_id trigger that re-derives both from the
    -- new parent material automatically; setting them here would just be
    -- immediately overwritten, and duplicating that logic risks drifting
    -- from the trigger's own if either is ever changed independently.
    UPDATE public.material_variants
       SET material_id = p_target_material_id,
           color_id = v_target_color_id
     WHERE id = v_variant_id;

    IF NOT (v_source_material_id = ANY(v_touched_materials)) THEN
      v_touched_materials := array_append(v_touched_materials, v_source_material_id);
    END IF;
  END LOOP;

  UPDATE public.materials
     SET active = false
   WHERE id = ANY(v_touched_materials)
     AND NOT EXISTS (
       SELECT 1 FROM public.material_variants mv WHERE mv.material_id = materials.id
     );
END;
$$;

GRANT EXECUTE ON FUNCTION move_variants_to_material(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION move_variants_to_material(uuid[], uuid) TO service_role;
REVOKE ALL ON FUNCTION move_variants_to_material(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION move_variants_to_material(uuid[], uuid) FROM anon;

CREATE OR REPLACE FUNCTION create_material_family_from_variants(p_variant_ids uuid[], p_name text, p_type_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id uuid;
  v_first_variant_id uuid;
  v_new_material_id uuid;
BEGIN
  -- The "+ New family..." target from the workbench: create an empty
  -- material, then hand it straight to move_variants_to_material for the
  -- actual moving/colour-remap/source-deactivation work -- one code path
  -- for both destinations, not two copies of the same logic to drift
  -- apart later. p_type_id is genuinely optional (materials.material_type_id
  -- has no NOT NULL constraint); when given, it must already exist for
  -- this organization -- never silently created.

  IF p_variant_ids IS NULL OR array_length(p_variant_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'create_material_family_from_variants: no variant ids provided';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'create_material_family_from_variants: name is required';
  END IF;

  v_first_variant_id := p_variant_ids[1];
  SELECT organization_id INTO v_org_id FROM public.material_variants WHERE id = v_first_variant_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'create_material_family_from_variants: variant % does not exist', v_first_variant_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.material_variants
     WHERE id = ANY(p_variant_ids)
       AND organization_id IS DISTINCT FROM v_org_id
  ) THEN
    RAISE EXCEPTION 'create_material_family_from_variants: all variants must belong to the same organization';
  END IF;

  IF p_type_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.material_types WHERE id = p_type_id AND organization_id = v_org_id) THEN
      RAISE EXCEPTION 'create_material_family_from_variants: material type % does not exist for this organization', p_type_id;
    END IF;
  END IF;

  INSERT INTO public.materials (organization_id, name, material_type_id, length_uom, active)
  VALUES (v_org_id, btrim(p_name), p_type_id, 'in', true)
  RETURNING id INTO v_new_material_id;

  PERFORM public.move_variants_to_material(p_variant_ids, v_new_material_id);

  RETURN v_new_material_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_material_family_from_variants(uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION create_material_family_from_variants(uuid[], text, uuid) TO service_role;
REVOKE ALL ON FUNCTION create_material_family_from_variants(uuid[], text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_material_family_from_variants(uuid[], text, uuid) FROM anon;
