-- ============================================================
-- Migration 115: Email template department tags + AI-personalize toggle
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Adds:
--   1. email_templates.department — text[], NOT NULL DEFAULT '{}'. A
--      template can be assigned to more than one department (e.g. visible
--      to both Production and Installation). Same array-column convention
--      already used for profiles.departments (text[] NOT NULL DEFAULT '{}',
--      see supabase/migrations/011_users_permissions.sql:14) — empty array
--      means "unassigned/general", not NULL, so downstream code only has
--      to handle one empty-case, not both null and [].
--
--      IMPORTANT: this is the STAFF FUNCTIONAL taxonomy (Sales, Design,
--      Production, Installation, Digital, Accounting, Admin, Customer
--      Service, Warehouse) — the same values stored in profiles.departments
--      via Settings > Team (see src/lib/staff-departments.ts,
--      STAFF_DEPARTMENTS — value strings are lowercase slugs: 'sales',
--      'design', 'production', 'installation', 'digital', 'accounting',
--      'admin', 'csr', 'warehouse'; confirmed by reading the actual write
--      path, src/app/api/settings/team/[id]/route.ts line 76,
--      `update.departments = body.departments`, which persists the
--      checkbox `value` attributes verbatim with no transformation).
--
--      This is DELIBERATELY NOT the same taxonomy as jobs.department / the
--      `departments` table (production job-routing categories like
--      'vehicle_wrap', 'channel_letters' — see 065_add_missing_departments.sql).
--      An earlier draft of this migration used that taxonomy by mistake;
--      it was wrong because the filtering code (quotes/[id]/page.tsx)
--      compares email_templates.department against profiles.departments,
--      which only ever contains the staff-functional values above.
--
--      Empty array means "unassigned/general" — existing templates stay
--      untouched and remain visible to everyone until an admin assigns
--      them a department; a template with department(s) set becomes
--      visible by default only to members of AT LEAST ONE of those
--      departments (plus Owner/Admin, who always see everything).
--   2. email_templates.ai_personalize — per-template toggle; when true,
--      sending this template runs it through AI personalization
--      (tailored to the specific order/customer) before send.
--
-- This migration was never run in production (per Ruben's report), so this
-- defines `department` as text[] directly rather than shipping it as a
-- scalar `text` column first and converting in a follow-up migration.

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS department text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_personalize boolean NOT NULL DEFAULT false;

-- Postgres has no IF NOT EXISTS on ADD CONSTRAINT — guard with a DO block,
-- same pattern as 065_add_missing_departments.sql. `<@` is Postgres's
-- array "is contained by" operator — this checks every element of
-- `department` is one of the 9 valid codes (an empty array trivially
-- satisfies this, so no separate NULL/empty carve-out is needed the way
-- the earlier scalar version needed `department IS NULL OR ...`).
DO $$
BEGIN
  ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_department_check;
EXCEPTION WHEN undefined_object THEN NULL;
END$$;

ALTER TABLE email_templates
  ADD CONSTRAINT email_templates_department_check
  CHECK (department <@ ARRAY[
    'sales', 'design', 'production', 'installation', 'digital',
    'accounting', 'admin', 'csr', 'warehouse'
  ]::text[]);

-- GIN index for array-overlap queries (e.g. `department && ARRAY['sales']`),
-- the standard index type for Postgres array containment/overlap lookups —
-- a plain btree index (as the earlier scalar-column version used) doesn't
-- support `&&`/`<@`/`@>` operators efficiently.
CREATE INDEX IF NOT EXISTS idx_email_templates_department ON email_templates USING GIN (department);

-- Grants — explicit per project policy (_TEMPLATE_migration.sql), even
-- though this is column-only (no new table). Standard Postgres semantics:
-- a table-level GRANT with no column list (as used below and in every
-- existing grant in this codebase) applies to the table as a whole,
-- including columns added later via ALTER TABLE ADD COLUMN — it is NOT
-- re-scoped or narrowed by adding columns after the fact. Column-level
-- grants (`GRANT SELECT (col) ON table ...`) are a distinct, separate
-- mechanism this codebase doesn't use anywhere. email_templates already
-- has an explicit whole-table grant on record:
--   supabase/migrations/057_backfill_grants.sql, lines 184-186:
--     grant select                         on public.email_templates to anon;
--     grant select, insert, update, delete on public.email_templates to authenticated;
--     grant select, insert, update, delete on public.email_templates to service_role;
-- So `department` and `ai_personalize` are already covered with zero gap
-- between this migration running and the columns being usable. Re-issuing
-- the same statements below is a no-op (GRANT is idempotent) — included
-- for audit-trail consistency with the _TEMPLATE_migration.sql pattern,
-- not because it changes anything.
grant select                         on public.email_templates to anon;
grant select, insert, update, delete on public.email_templates to authenticated;
grant select, insert, update, delete on public.email_templates to service_role;
