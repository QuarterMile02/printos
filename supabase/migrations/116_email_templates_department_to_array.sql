-- ============================================================
-- Migration 116: Convert email_templates.department from scalar to array
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Migration 115 shipped department as a scalar `text` column and ran
-- successfully in production. A later commit needed department to support
-- MULTIPLE values per template (e.g. visible to both Production and
-- Installation) and rewrote 115's file to define department as `text[]`
-- from the start -- but 115 had already been run, so that rewrite was a
-- no-op against the live column (ADD COLUMN IF NOT EXISTS silently skips
-- when the column already exists, regardless of type), and the CHECK
-- constraint in that rewrite used the `<@` array-containment operator
-- against a column Postgres still saw as scalar text, which is exactly
-- why it failed with: "operator does not exist: text <@ text[]".
--
-- Verified the live state directly (not assumed) before writing this:
-- queried email_templates via the REST API with the service role key.
-- Confirmed:
--   - department is live as scalar text (rows serialize as
--     "department": null or "department": "design", never as an array).
--   - ai_personalize already exists as boolean and needs NO changes here
--     -- it was unaffected by the department mistake (both `true` and
--     `false` values present and correctly typed).
--   - Row count: 27. Two rows already have a real value set
--     (department = 'design', both with ai_personalize = true) -- these
--     MUST survive as a one-element array ['design'], not get dropped.
--     The USING clause below handles that explicitly.
--
-- This migration does the actual type conversion migration 115 was
-- supposed to end up at, safely, against the real current state:
--   1. Drop the old scalar CHECK constraint (115's), which is incompatible
--      with an array column and would block the ALTER COLUMN TYPE below.
--   2. Convert department text -> text[], preserving existing values:
--      NULL becomes '{}' (empty array = unassigned/general, same meaning
--      as NULL did before), any existing single value becomes a one-
--      element array (e.g. 'design' -> ARRAY['design']).
--   3. Set DEFAULT '{}' and NOT NULL now that no row can be NULL anymore
--      (the USING clause already converted every NULL to '{}').
--   4. Replace the old btree index with a GIN index -- the correct index
--      type for Postgres array containment/overlap operators (<@, &&, @>);
--      a btree index doesn't support them efficiently. CREATE INDEX IF NOT
--      EXISTS would NOT have replaced the old btree index automatically
--      (it only checks the index NAME, not its definition), so the old one
--      is dropped explicitly first.
--   5. Add the new array-aware CHECK constraint (the one 115's rewrite
--      tried and failed to add).

DO $$
BEGIN
  ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_department_check;
EXCEPTION WHEN undefined_object THEN NULL;
END$$;

ALTER TABLE email_templates
  ALTER COLUMN department TYPE text[]
  USING CASE WHEN department IS NULL THEN '{}'::text[] ELSE ARRAY[department] END;

ALTER TABLE email_templates
  ALTER COLUMN department SET DEFAULT '{}',
  ALTER COLUMN department SET NOT NULL;

DROP INDEX IF EXISTS idx_email_templates_department;
CREATE INDEX idx_email_templates_department ON email_templates USING GIN (department);

ALTER TABLE email_templates
  ADD CONSTRAINT email_templates_department_check
  CHECK (department <@ ARRAY[
    'sales', 'design', 'production', 'installation', 'digital',
    'accounting', 'admin', 'csr', 'warehouse'
  ]::text[]);

-- Grants — no-op (email_templates already has an explicit whole-table
-- grant from supabase/migrations/057_backfill_grants.sql, and this
-- migration doesn't add a new column, just changes an existing one's
-- type), included for audit-trail consistency with the _TEMPLATE_migration.sql
-- pattern, same reasoning as migration 115.
grant select                         on public.email_templates to anon;
grant select, insert, update, delete on public.email_templates to authenticated;
grant select, insert, update, delete on public.email_templates to service_role;
