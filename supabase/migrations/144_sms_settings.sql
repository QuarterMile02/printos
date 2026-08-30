-- ============================================================
-- Migration 144: sms_settings / sms_templates -- relocated from stray
-- src/supabase/migrations/082_sms_settings.sql into the canonical
-- supabase/migrations/ directory Supabase actually applies against.
-- Content unchanged, verbatim -- introspection this session confirmed
-- zero drift between this file and the live sms_settings table
-- (id, organization_id, twilio_account_sid, twilio_auth_token,
-- twilio_phone_number, country_code, is_connected, created_at,
-- updated_at all match).
--
-- Already live and already applied -- IF NOT EXISTS is a no-op
-- against production. This commit only makes the repo match reality;
-- nothing changes live. See supabase/migrations/104_carrier_connections.sql
-- for the pre-existing note documenting the sibling
-- payment_gateway_settings misplacement -- same stray-directory issue.
-- ============================================================

CREATE TABLE IF NOT EXISTS sms_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  twilio_account_sid text,
  twilio_auth_token text,
  twilio_phone_number text,
  country_code text DEFAULT 'US',
  is_connected boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE sms_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON sms_settings TO authenticated, service_role;
CREATE POLICY "org members can manage sms settings" ON sms_settings FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS sms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  body text NOT NULL,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE sms_templates ENABLE ROW LEVEL SECURITY;
GRANT ALL ON sms_templates TO authenticated, service_role;
CREATE POLICY "org members can manage sms templates" ON sms_templates FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

-- Seed QMI Twilio config (account SID/token stored as env vars, just mark connected)
INSERT INTO sms_settings (organization_id, twilio_phone_number, country_code, is_connected)
SELECT id, '+19562348791', 'US', true FROM organizations WHERE slug = 'quarter-mile-inc'
ON CONFLICT DO NOTHING;
