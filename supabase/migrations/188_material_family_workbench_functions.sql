CREATE OR REPLACE FUNCTION move_variants_to_material(p_variant_ids uuid[], p_target_material_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_target_org_id uuid;
  v_target_length_uom text;
  v_variant_id uuid;
  v_variant record;
  v_source_color_name text;
  v_source_color_code text;
  v_source_color_stocked boolean;
  v_target_color_id uuid;
  v_new_is_default boolean;
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
  -- is_default is the ONLY field that can change value on a move -- every
  -- other column (cost, multiplier, price, width, height, length_increment,
  -- fixed_side, ...) moves completely unchanged. Ruben's decision, and the
  -- rule below implements it exactly: if the target (material, colour)
  -- bucket already has a default, an incoming default-flagged variant
  -- arrives with is_default FORCED to false -- the target's existing
  -- default wins, is never displaced by a move. Only when the target
  -- bucket has no default at all does the incoming variant keep whatever
  -- is_default value it already had. This can never leave two
  -- is_default=true rows in one bucket -- idx_material_variants_one_
  -- default_per_color (migration 181) would reject that outright, and
  -- this rule never tries to create the conflict in the first place.
  --
  -- WHY the target wins rather than the incoming variant (the opposite of
  -- this function's first draft): is_default is read live by Stage A's
  -- selectMaterialVariant (src/lib/pricing/formula-engine.ts) as a
  -- pricing input for every OTHER product recipe already pointed at this
  -- target family. Letting an incoming move silently flip which variant
  -- prices those other recipes would change a price in a family the user
  -- wasn't editing, as a side effect of an unrelated move into it. Once
  -- the nester exists, is_default is expected to stop being a pricing
  -- input -- revisit this rule at that point, it's only load-bearing
  -- while is_default still drives a live price.
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
  --
  -- length_uom is checked and refused on mismatch, NOT re-derived like
  -- organization_id is. Both are re-derived by the same trigger
  -- (sync_material_variant_before_write, 173) the instant material_id
  -- changes, but they are not the same kind of value. organization_id is
  -- an identity label: this function already REQUIRES the variant's org
  -- and the target's org to match before it ever reaches the UPDATE (the
  -- check above), so the trigger re-deriving it is a no-op write of the
  -- value that was already guaranteed identical -- nothing about scoping
  -- actually changes. length_uom has no such prior guarantee, and it is
  -- not a label -- it is a live input to a GENERATED column:
  --   sqft = (width/12) * material_length_to_feet(height, length_uom)
  --   cost_per_unit = total_cost / sqft
  -- (173_material_variants_table.sql:186-206). material_length_to_feet
  -- converts in/ft/yd by a real factor (÷12, ×1, ×3). If this function
  -- let the trigger silently rewrite a variant's length_uom to the
  -- target's, sqft would silently recompute against a different unit and
  -- cost_per_unit would rescale with it -- by 3x for a yd<->in move --
  -- while every other column, per the rule above, is supposed to move
  -- completely unchanged. Refusing instead of converting is deliberate:
  -- the workbench can surface this conflict and let a human decide, which
  -- a silent 3x cost change cannot.

  IF p_variant_ids IS NULL OR array_length(p_variant_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'move_variants_to_material: no variant ids provided';
  END IF;

  SELECT organization_id, length_uom INTO v_target_org_id, v_target_length_uom
    FROM public.materials WHERE id = p_target_material_id;
  IF v_target_org_id IS NULL THEN
    RAISE EXCEPTION 'move_variants_to_material: target material % does not exist', p_target_material_id;
  END IF;

  FOREACH v_variant_id IN ARRAY p_variant_ids LOOP
    SELECT id, material_id, color_id, organization_id, is_default, length_uom
      INTO v_variant
      FROM public.material_variants
     WHERE id = v_variant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'move_variants_to_material: variant % does not exist', v_variant_id;
    END IF;

    IF v_variant.organization_id IS DISTINCT FROM v_target_org_id THEN
      RAISE EXCEPTION 'move_variants_to_material: variant % belongs to a different organization than target material %', v_variant_id, p_target_material_id;
    END IF;

    IF v_variant.length_uom IS DISTINCT FROM v_target_length_uom THEN
      RAISE EXCEPTION 'move_variants_to_material: variant % has length_uom % but target material % has length_uom % -- refusing to move it. sqft (and therefore cost_per_unit) is generated from length_uom, so this move would silently rescale its cost -- by 3x for a yd<->in mismatch -- rather than leave it unchanged like every other column',
        v_variant_id, v_variant.length_uom, p_target_material_id, v_target_length_uom;
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

    -- v_new_is_default: see the rule and its reasoning above the loop.
    -- true only when the variant was already the default AND the target
    -- bucket has no default of its own to defer to.
    v_new_is_default := v_variant.is_default AND NOT EXISTS (
      SELECT 1 FROM public.material_variants
       WHERE material_id = p_target_material_id
         AND color_id IS NOT DISTINCT FROM v_target_color_id
         AND is_default = true
    );

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
    -- This re-derivation is a genuine no-op for BOTH columns by the time
    -- execution reaches here, but for two different reasons: organization_id
    -- was already required to match (the check above), and length_uom was
    -- already required to match (the check above the loop) -- neither
    -- check exists to make this UPDATE line correct in isolation; they
    -- exist because a mismatch on either would be a real, live bug (a
    -- cross-org write, or a silently rescaled cost_per_unit) that this
    -- function refuses before ever reaching this UPDATE.
    -- is_default is the only other column this UPDATE touches -- every
    -- remaining column keeps its existing value untouched, unlisted.
    UPDATE public.material_variants
       SET material_id = p_target_material_id,
           color_id = v_target_color_id,
           is_default = v_new_is_default
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
  v_length_uom text;
  v_first_variant_id uuid;
  v_new_material_id uuid;
BEGIN
  -- The "+ New family..." target from the workbench: create an empty
  -- material, then hand it straight to move_variants_to_material for the
  -- actual moving/colour-remap/source-deactivation work -- one code path
  -- for both destinations, not two copies of the same logic to drift
  -- apart later.
  --
  -- Exactly what the new materials row gets, field by field:
  --   organization_id    derived from the variants being moved in (below),
  --                       never a caller-supplied value -- see the
  --                       cross-org check below.
  --   material_type_id   p_type_id as given. Genuinely optional
  --                       (materials.material_type_id has no NOT NULL
  --                       constraint); when given, must already exist for
  --                       this organization -- never silently created.
  --   length_uom          derived from the variants being moved in (below)
  --                       -- NOT hardcoded 'in'. length_uom is not a label
  --                       like organization_id; it is a live input to
  --                       material_variants' generated sqft column
  --                       (sqft = width_ft * material_length_to_feet(height,
  --                       length_uom), 173_material_variants_table.sql:
  --                       186-206), which cost_per_unit is itself derived
  --                       from. Hardcoding 'in' here and letting
  --                       sync_material_variant_before_write (173)
  --                       silently rewrite each moved-in variant's
  --                       length_uom to match would rescale its sqft --
  --                       and therefore its cost_per_unit -- by 3x for a
  --                       yd variant moved into a hardcoded-'in' family,
  --                       even though every other column is supposed to
  --                       move completely unchanged. If the variants being
  --                       moved in don't all share one length_uom, this
  --                       function refuses rather than pick one -- see the
  --                       check below.
  --   multiplier          left NULL. Deliberately NOT inherited from the
  --                       variants being moved in: they can have
  --                       genuinely different multipliers (that's real,
  --                       existing data, not an error), so picking any
  --                       one of them to promote onto the material row
  --                       would be exactly the kind of invented number
  --                       migration 187 exists to refuse -- a 0 here
  --                       would recreate that bug from the other
  --                       direction, and picking a non-zero value with no
  --                       single correct source is no better. NULL is
  --                       honest, matches accept_family_proposal's (182)
  --                       own reasoning for this same column ("materials.
  --                       multiplier is nullable... left NULL, honestly,
  --                       rather than invented"), and is safe: this
  --                       column is never read by calculateProductPrice
  --                       (confirmed -- its materials select list is
  --                       `id, name, cost, price, selling_units`, no
  --                       multiplier at all). Pricing for this family
  --                       comes from its variants' own multiplier column,
  --                       not this one.
  --   cost, price          left at the table default (0, NOT NULL
  --                       columns) -- explicit in the INSERT below rather
  --                       than silently relying on the default, so the
  --                       choice is visible here rather than implicit.
  --                       Never read by calculateProductPrice for a
  --                       material with real variants, which this always
  --                       has the moment this function returns (it always
  --                       moves at least one variant in, per the
  --                       non-empty check below).
  --   formula             left unset (table default 'Area'). Not read by
  --                       calculateProductPrice at all -- that engine
  --                       reads a recipe item's own system_formula (or
  --                       the parent PRODUCT's formula), never
  --                       materials.formula.

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

  -- length_uom: derive from the variants being moved in, never hardcode.
  -- See the field-by-field comment above for why this matters (sqft/
  -- cost_per_unit are generated from it). If they don't all agree on one
  -- length_uom, refuse -- do not pick one, same "never invent" principle
  -- as the multiplier decision below.
  IF (SELECT count(DISTINCT length_uom) FROM public.material_variants WHERE id = ANY(p_variant_ids)) <> 1 THEN
    RAISE EXCEPTION 'create_material_family_from_variants: the variants being moved in do not all share one length_uom -- refusing to invent one for the new family';
  END IF;
  SELECT length_uom INTO v_length_uom FROM public.material_variants WHERE id = v_first_variant_id;

  -- multiplier and formula are deliberately absent from this column list --
  -- see the field-by-field comment above. cost/price are listed explicitly
  -- as 0 (their table default) so the choice is visible here, not implicit.
  INSERT INTO public.materials (organization_id, name, material_type_id, length_uom, cost, price, active)
  VALUES (v_org_id, btrim(p_name), p_type_id, v_length_uom, 0, 0, true)
  RETURNING id INTO v_new_material_id;

  PERFORM public.move_variants_to_material(p_variant_ids, v_new_material_id);

  RETURN v_new_material_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_material_family_from_variants(uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION create_material_family_from_variants(uuid[], text, uuid) TO service_role;
REVOKE ALL ON FUNCTION create_material_family_from_variants(uuid[], text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_material_family_from_variants(uuid[], text, uuid) FROM anon;
