-- Phase 16: Email signatures per user per org

CREATE TABLE IF NOT EXISTS email_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '',
  is_html boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_email_signatures_user_org
  ON email_signatures(user_id, organization_id);

ALTER TABLE email_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage own signature" ON email_signatures;
CREATE POLICY "users manage own signature" ON email_signatures
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_email_signatures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_email_signatures_updated_at ON email_signatures;
CREATE TRIGGER trg_email_signatures_updated_at
  BEFORE UPDATE ON email_signatures
  FOR EACH ROW EXECUTE FUNCTION update_email_signatures_updated_at();
