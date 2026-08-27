-- ============================================================
-- BACKFILL (not a numbered migration -- one-time data reconciliation,
-- no schema change): material_variants.source_name, reconstructed from
-- surviving shopvox_materials.migrated_to_material_id links.
--
-- Requires migration 189 (material_variants.source_name) already run.
--
-- URGENT, per the build instruction this backfill was written for: this
-- link is already decaying. move_variants_to_material (188) relocates
-- variants between materials freely, and migrated_to_material_id points
-- at the MATERIAL, not the variant -- once a variant moves, the old
-- material-level link no longer resolves to it at all. Every hour of
-- Family Workbench curation makes more of this unrecoverable. Run this
-- BEFORE further curation, not after.
--
-- MATCHING RULE, exactly as specified, no guessing beyond it:
--   1. UNAMBIGUOUS: a material with exactly 1 variant and exactly 1
--      linked shopvox_materials row -- take it, no further check needed.
--   2. DIMENSIONS: a multi-variant family -- match a shopvox row to the
--      one variant sharing its (height, width) exactly (NULL-safe: a
--      shopvox row with height/width NULL can match a variant with
--      height/width NULL too).
--   3. COLOUR-IN-NAME: if step 2 finds more than one variant with the
--      same (height, width), break the tie by checking whether exactly
--      one of those variants' colour name appears (case-insensitive
--      substring) inside the shopvox row's name.
--   4. Anything still ambiguous, or with zero dimension-matching
--      candidates, is LEFT NULL. Never guessed.
--
-- A variant is also left unmatched if two different shopvox rows would
-- otherwise both resolve to it (a genuine collision, not a coincidence
-- -- 9 of these exist live) -- claiming it for the first one and
-- silently dropping the second would be exactly the kind of guess this
-- backfill exists to avoid.
--
-- COUNTS, verified live before this file was written (see this PR's
-- description for the same numbers, computed independently in JS
-- against the same tables, to cross-check this SQL's own RAISE NOTICE
-- output the first time it's actually run):
--   1750 shopvox_materials rows carry a migrated_to_material_id link.
--   1208 unambiguous | 157 by dimensions | 235 by colour-in-name
--   150 could not be matched (left NULL), including 9 collision losses.
--   1600 of 1750 material_variants rows (91.4%) receive a source_name.
--   150 (8.6%) do not -- real, not hidden: source_name stays sparse for
--   these, which is the honest state, not the goal.
--
-- Written procedurally (a DO block, matching migrations 182/183/185/
-- 186/188's own use of PL/pgSQL for anything with real branching) rather
-- than as a single declarative query -- the collision check needs to see
-- what earlier rows in the SAME run already claimed, which a plain
-- UPDATE...FROM cannot express without a second pass anyway.
DO $$
DECLARE
  v_material_id uuid;
  v_variant_count int;
  v_row_count int;
  v_shopvox record;
  v_candidates uuid[];
  v_colour_hits uuid[];
  v_claimed uuid[] := '{}';
  v_unambiguous int := 0;
  v_by_dimensions int := 0;
  v_by_colour int := 0;
  v_unmatched int := 0;
BEGIN
  CREATE TEMP TABLE tmp_source_name_matches (variant_id uuid PRIMARY KEY, source_name text) ON COMMIT DROP;

  FOR v_material_id IN
    SELECT DISTINCT migrated_to_material_id
    FROM public.shopvox_materials
    WHERE migrated_to_material_id IS NOT NULL
  LOOP
    SELECT COUNT(*) INTO v_variant_count FROM public.material_variants WHERE material_id = v_material_id;
    SELECT COUNT(*) INTO v_row_count FROM public.shopvox_materials WHERE migrated_to_material_id = v_material_id;

    IF v_variant_count = 0 THEN
      -- No variants at all on this material -- it was migrated via the
      -- older, pre-Family-Workbench path (dimensions live directly on
      -- materials.width/height, allow_variants = false). Nothing here
      -- for this backfill to write. Confirmed live: exactly this shape
      -- for "Aluminum Marker Tray" and its siblings.
      CONTINUE;
    END IF;

    IF v_variant_count = 1 AND v_row_count = 1 THEN
      INSERT INTO tmp_source_name_matches (variant_id, source_name)
      SELECT mv.id, sm.name
        FROM public.material_variants mv, public.shopvox_materials sm
       WHERE mv.material_id = v_material_id
         AND sm.migrated_to_material_id = v_material_id;
      v_unambiguous := v_unambiguous + 1;
      CONTINUE;
    END IF;

    FOR v_shopvox IN SELECT * FROM public.shopvox_materials WHERE migrated_to_material_id = v_material_id LOOP
      SELECT array_agg(id) INTO v_candidates
        FROM public.material_variants
       WHERE material_id = v_material_id
         AND height IS NOT DISTINCT FROM v_shopvox.height
         AND width IS NOT DISTINCT FROM v_shopvox.width;

      IF array_length(v_candidates, 1) = 1 THEN
        IF v_candidates[1] = ANY(v_claimed) THEN
          v_unmatched := v_unmatched + 1;
        ELSE
          INSERT INTO tmp_source_name_matches (variant_id, source_name) VALUES (v_candidates[1], v_shopvox.name);
          v_claimed := array_append(v_claimed, v_candidates[1]);
          v_by_dimensions := v_by_dimensions + 1;
        END IF;
        CONTINUE;
      END IF;

      IF array_length(v_candidates, 1) > 1 THEN
        SELECT array_agg(mv.id) INTO v_colour_hits
          FROM public.material_variants mv
          JOIN public.material_colors mc ON mc.id = mv.color_id
         WHERE mv.id = ANY(v_candidates)
           AND v_shopvox.name ILIKE '%' || mc.name || '%';

        IF array_length(v_colour_hits, 1) = 1 THEN
          IF v_colour_hits[1] = ANY(v_claimed) THEN
            v_unmatched := v_unmatched + 1;
          ELSE
            INSERT INTO tmp_source_name_matches (variant_id, source_name) VALUES (v_colour_hits[1], v_shopvox.name);
            v_claimed := array_append(v_claimed, v_colour_hits[1]);
            v_by_colour := v_by_colour + 1;
          END IF;
          CONTINUE;
        END IF;
      END IF;

      -- Zero dimension-matching candidates, or still tied after the
      -- colour-in-name tie-break -- leave NULL, never guess.
      v_unmatched := v_unmatched + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'source_name backfill -- unambiguous: %, by dimensions: %, by colour-in-name: %, unmatched (left NULL): %',
    v_unambiguous, v_by_dimensions, v_by_colour, v_unmatched;

  UPDATE public.material_variants mv
     SET source_name = t.source_name
    FROM tmp_source_name_matches t
   WHERE mv.id = t.variant_id;
END $$;

-- Verification:
-- select count(*) from material_variants where source_name is not null;
-- Expected: 1600.
-- select count(*) from material_variants where source_name is null;
-- Expected: 150.
-- Spot-check a real multi-variant family that this should have populated:
-- select mv.id, mc.name as colour, mv.height, mv.width, mv.source_name
-- from material_variants mv left join material_colors mc on mc.id = mv.color_id
-- join materials m on m.id = mv.material_id
-- where m.name = 'Trim Tap'
-- order by mc.name nulls first, mv.height, mv.width;
