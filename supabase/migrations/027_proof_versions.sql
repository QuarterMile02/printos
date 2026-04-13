-- Phase 10: Proof versions table for job proofs

CREATE TABLE IF NOT EXISTS proof_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  uploaded_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE proof_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY pv_select_members ON proof_versions FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pv_insert_non_viewers ON proof_versions FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role <> 'viewer')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY pv_update_non_viewers ON proof_versions FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role <> 'viewer')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_proof_versions_job ON proof_versions(job_id);
