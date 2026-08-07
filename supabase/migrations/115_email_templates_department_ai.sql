-- ============================================================
-- Migration 115: Email template department tag + AI-personalize toggle
-- Applied: (pending — run manually in Supabase SQL Editor)
-- ============================================================
--
-- Adds:
--   1. email_templates.department — nullable text, matching the SAME
--      department codes already enforced on jobs.department (see
--      065_add_missing_departments.sql). NULL means "unassigned/general" —
--      existing templates stay untouched and remain visible to everyone
--      until an admin assigns them a department; a template with a
--      department set becomes visible by default only to members of that
--      department (plus Owner/Admin, who always see everything).
--   2. email_templates.ai_personalize — per-template toggle; when true,
--      sending this template runs it through AI personalization
--      (tailored to the specific order/customer) before send.
--
-- No new table, so no new GRANT statements are needed — email_templates
-- already has its grants/RLS policy from 029_email_templates.sql, which
-- cover new columns on the same table automatically.

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS ai_personalize boolean NOT NULL DEFAULT false;

-- Postgres has no IF NOT EXISTS on ADD CONSTRAINT — guard with a DO block,
-- same pattern as 065_add_missing_departments.sql.
DO $$
BEGIN
  ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_department_check;
EXCEPTION WHEN undefined_object THEN NULL;
END$$;

ALTER TABLE email_templates
  ADD CONSTRAINT email_templates_department_check
  CHECK (department IS NULL OR department IN (
    'large_format',      'commercial_print', 'vehicle_wrap',      'channel_letters',
    'fabrication',       'installation',     'service_repair',
    'digital_marketing', 'digital_screens',
    'design',            'branding',         'direct_mail',
    'promotional',       'apparel'
  ));

CREATE INDEX IF NOT EXISTS idx_email_templates_department ON email_templates(organization_id, department);
