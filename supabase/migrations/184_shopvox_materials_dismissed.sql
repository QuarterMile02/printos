-- ============================================================
-- Migration 184: shopvox_materials.dismissed_at + DISMISSED status -- item 3.
-- Applied: PROPOSED, NOT run. Requires 179 (shopvox_materials) already
-- live -- confirmed live in production per instruction.
-- ============================================================
--
-- Rows that are junk, discontinued, or will never be migrated currently
-- stay NEW forever and clutter the queue. dismissed_at makes that state
-- explicit and REVERSIBLE (a timestamp, not a delete, not a boolean
-- that loses the "when" and can't distinguish "never touched" from
-- "explicitly dismissed").
--
-- *** status IS A GENERATED COLUMN. Postgres has no ALTER COLUMN ...
-- *** to change a generated column's expression -- the only way to add
-- *** a new CASE branch is DROP the column and ADD it again with the
-- *** new expression. Statements 3-5 below do exactly that, in order:
-- *** drop the dependent index first (explicit, not relying on it being
-- *** auto-dropped), drop the column, re-add it with DISMISSED wired
-- *** in, then recreate the index. Paste all three of those together as
-- *** one sitting -- don't leave the table mid-sequence with no status
-- *** column between statements 4 and 5's paste, even briefly, since
-- *** every other query in this app that filters by status would break
-- *** until it's back.
--
-- DISMISSED takes priority over every other state in the CASE (checked
-- first) -- a dismissed row stays DISMISSED even if it was previously
-- linked to a material (migrated_to_material_id set) or would otherwise
-- read as CHANGED/MIGRATED, since dismissing is the more recent,
-- explicit decision. Restoring (clearing dismissed_at) is the only way
-- back -- reversible, per instruction.

-- ------------------------------------------------------------
-- STATEMENT 1 of 5 -- add the column.
-- ------------------------------------------------------------
ALTER TABLE public.shopvox_materials
  ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

-- Verification:
-- select column_name, data_type from information_schema.columns
-- where table_schema = 'public' and table_name = 'shopvox_materials' and column_name = 'dismissed_at';
-- Expected: one row -- dismissed_at | timestamp with time zone

-- ------------------------------------------------------------
-- STATEMENT 2 of 5 -- drop the index that depends on `status`, before
-- dropping the column itself.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS idx_shopvox_materials_status;

-- Verification:
-- select indexname from pg_indexes where tablename = 'shopvox_materials' and indexname = 'idx_shopvox_materials_status';
-- Expected: 0 rows.

-- ------------------------------------------------------------
-- STATEMENT 3 of 5 -- drop the generated column. *** Paste statements
-- 3, 4, and 5 in the same sitting -- the table has no `status` column
-- at all between this statement and statement 4. ***
-- ------------------------------------------------------------
ALTER TABLE public.shopvox_materials
  DROP COLUMN status;

-- Verification:
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'shopvox_materials' and column_name = 'status';
-- Expected: 0 rows.

-- ------------------------------------------------------------
-- STATEMENT 4 of 5 -- re-add it with DISMISSED wired in, checked first.
-- ------------------------------------------------------------
ALTER TABLE public.shopvox_materials
  ADD COLUMN status text GENERATED ALWAYS AS (
    CASE
      WHEN dismissed_at IS NOT NULL THEN 'DISMISSED'
      WHEN migrated_to_material_id IS NULL THEN 'NEW'
      WHEN source_hash IS NOT DISTINCT FROM migrated_source_hash THEN 'MIGRATED'
      ELSE 'CHANGED'
    END
  ) STORED;

-- Verification:
-- select column_name, is_generated from information_schema.columns
-- where table_schema = 'public' and table_name = 'shopvox_materials' and column_name = 'status';
-- Expected: one row -- status | ALWAYS
--
-- select status, count(*) from shopvox_materials group by status order by status;
-- Expected: same NEW/MIGRATED/CHANGED counts as before this migration (every existing row
-- re-evaluates through the new CASE, but none had dismissed_at set until statement 1 just
-- added the column, so DISMISSED should read 0 here).

-- ------------------------------------------------------------
-- STATEMENT 5 of 5 -- recreate the index.
-- ------------------------------------------------------------
CREATE INDEX idx_shopvox_materials_status ON public.shopvox_materials(organization_id, status);

-- Verification:
-- select indexname from pg_indexes where tablename = 'shopvox_materials' and indexname = 'idx_shopvox_materials_status';
-- Expected: one row.
--
-- -- Full functional smoke test -- dismiss a row, confirm status flips,
-- -- confirm restoring it flips back:
-- update shopvox_materials set dismissed_at = now()
-- where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' and status = 'NEW'
-- limit 1
-- returning id, status; -- expect status = 'DISMISSED' in the RETURNING output
--
-- -- (RETURNING reflects the row as of the UPDATE; to re-check after the
-- -- fact, re-select the same row by id)
-- select status from shopvox_materials where dismissed_at is not null and organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' limit 1;
-- Expected: 'DISMISSED'
--
-- update shopvox_materials set dismissed_at = null
-- where organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a' and dismissed_at is not null
-- returning id, status; -- expect status back to 'NEW' (or whatever it would otherwise be)
