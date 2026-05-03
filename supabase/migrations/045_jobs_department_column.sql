-- ── 1+2. Improve departments table + seed 9 departments ──────────────────────
ALTER TABLE departments ADD COLUMN IF NOT EXISTS code        text;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS is_active   boolean DEFAULT true;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sort_order  int     DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS departments_org_code_uq
  ON departments(organization_id, code)
  WHERE code IS NOT NULL;

INSERT INTO departments (organization_id, name, code, is_active, sort_order)
SELECT
  o.id,
  d.name,
  d.code,
  true,
  d.sort_order
FROM organizations o
CROSS JOIN (VALUES
  ('Large Format',      'large_format',       1),
  ('Commercial Print',  'commercial_print',    2),
  ('Vehicle Wrap',      'vehicle_wrap',        3),
  ('Channel Letters',   'channel_letters',     4),
  ('Fabrication',       'fabrication',         5),
  ('Installation',      'installation',        6),
  ('Service & Repair',  'service_repair',      7),
  ('Digital Marketing', 'digital_marketing',   8),
  ('Digital Screens',   'digital_screens',     9)
) AS d(name, code, sort_order)
ON CONFLICT (organization_id, code) WHERE code IS NOT NULL DO NOTHING;

-- ── 3. Add department column to jobs ─────────────────────────────────────────
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS department text
  CHECK (department IN (
    'large_format', 'commercial_print', 'vehicle_wrap', 'channel_letters',
    'fabrication',  'installation',     'service_repair',
    'digital_marketing', 'digital_screens'
  ));

CREATE INDEX IF NOT EXISTS idx_jobs_department
  ON jobs(organization_id, department);

-- ── 4. Backfill jobs.department from assigned_printer ────────────────────────
UPDATE jobs
SET department = CASE lower(trim(assigned_printer))
  WHEN 'large_format'      THEN 'large_format'
  WHEN 'commercial'        THEN 'commercial_print'
  WHEN 'commercial_print'  THEN 'commercial_print'
  WHEN 'installation'      THEN 'installation'
  WHEN 'fabrication'       THEN 'fabrication'
  WHEN 'digital'           THEN 'digital_marketing'
  WHEN 'digital_marketing' THEN 'digital_marketing'
  WHEN 'digital_screens'   THEN 'digital_screens'
  WHEN 'vehicle_wrap'      THEN 'vehicle_wrap'
  WHEN 'channel_letters'   THEN 'channel_letters'
  WHEN 'service_repair'    THEN 'service_repair'
  ELSE NULL
END
WHERE assigned_printer IS NOT NULL
  AND department IS NULL;

-- ── 5. Add primary_department to product_categories ──────────────────────────
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS primary_department text
  CHECK (primary_department IN (
    'large_format', 'commercial_print', 'vehicle_wrap', 'channel_letters',
    'fabrication',  'installation',     'service_repair',
    'digital_marketing', 'digital_screens'
  ));

-- ── 6. Workflow step progress table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs_workflow_progress (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  step_id         uuid        REFERENCES product_default_items(id) ON DELETE SET NULL,
  step_name       text        NOT NULL,
  sort_order      int         DEFAULT 0,
  checked_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  checked_at      timestamptz,
  UNIQUE (job_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_jobs_workflow_progress_job
  ON jobs_workflow_progress(job_id);

ALTER TABLE jobs_workflow_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view workflow progress"
  ON jobs_workflow_progress FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = jobs_workflow_progress.organization_id
      AND organization_members.user_id = auth.uid()
  ));

CREATE POLICY "Org members can manage workflow progress"
  ON jobs_workflow_progress FOR ALL
  USING (EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_members.organization_id = jobs_workflow_progress.organization_id
      AND organization_members.user_id = auth.uid()
      AND organization_members.role IN ('owner', 'admin', 'member')
  ));
