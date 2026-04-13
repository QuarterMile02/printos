-- Phase 10: QR time tracking

CREATE TABLE IF NOT EXISTS job_time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('clock_in', 'clock_out')),
  stage text,
  duration_minutes numeric(10,2),
  notes text,
  scanned_at timestamptz DEFAULT now()
);

ALTER TABLE job_time_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY jtl_select_members ON job_time_logs FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY jtl_insert_members ON job_time_logs FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_job_time_logs_job ON job_time_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_time_logs_user ON job_time_logs(user_id);
