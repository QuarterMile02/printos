-- ============================================================
-- Migration 065: Add missing QMI departments
-- Applied: 2026-07-11
-- ============================================================

-- 1. Insert 5 missing departments for QMI
INSERT INTO departments (organization_id, name, code, is_active, sort_order)
SELECT
  o.id,
  d.name,
  d.code,
  true,
  d.sort_order
FROM (VALUES
  ('Design',      'design',      10),
  ('Branding',    'branding',    11),
  ('Direct Mail', 'direct_mail', 12),
  ('Promotional', 'promotional', 13),
  ('Apparel',     'apparel',     14)
) AS d(name, code, sort_order)
CROSS JOIN (SELECT id FROM organizations WHERE slug = 'quarter-mile-inc') AS o
ON CONFLICT (organization_id, code) WHERE code IS NOT NULL DO NOTHING;

-- 2. Widen the jobs.department CHECK constraint to include new codes.
--    Drop the old constraint and replace it — Postgres has no IF NOT EXISTS
--    on ADD CONSTRAINT, so we guard with a DO block.
DO $$
BEGIN
  ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_department_check;
EXCEPTION WHEN undefined_object THEN NULL;
END$$;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_department_check
  CHECK (department IN (
    'large_format',     'commercial_print', 'vehicle_wrap',      'channel_letters',
    'fabrication',      'installation',     'service_repair',
    'digital_marketing','digital_screens',
    'design',           'branding',         'direct_mail',
    'promotional',      'apparel'
  ));

-- Grants (departments table already granted in 057_backfill_grants; included
-- here for completeness in case this migration runs on a fresh DB)
grant select                         on public.departments to anon;
grant select, insert, update, delete on public.departments to authenticated;
grant select, insert, update, delete on public.departments to service_role;
