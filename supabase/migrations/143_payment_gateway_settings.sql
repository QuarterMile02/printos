-- ============================================================
-- Migration 143: payment_gateway_settings -- relocated from stray
-- src/supabase/migrations/083_payment_gateway_settings.sql into the
-- canonical supabase/migrations/ directory Supabase actually applies
-- against. Content unchanged, verbatim -- introspection this session
-- confirmed zero drift between this file and the live table
-- (id, organization_id, gateway_type, api_login_id, transaction_key,
-- use_test_mode, is_connected, created_at, updated_at all match).
--
-- Already live and already applied -- IF NOT EXISTS is a no-op
-- against production. This commit only makes the repo match reality;
-- nothing changes live. See supabase/migrations/104_carrier_connections.sql
-- for the pre-existing note documenting this misplacement.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_gateway_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  gateway_type text DEFAULT 'authorize_net',
  api_login_id text,
  transaction_key text,
  use_test_mode boolean DEFAULT false,
  is_connected boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE payment_gateway_settings ENABLE ROW LEVEL SECURITY;
GRANT ALL ON payment_gateway_settings TO authenticated, service_role;
CREATE POLICY "org members can manage payment gateway" ON payment_gateway_settings FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

INSERT INTO payment_gateway_settings (organization_id, gateway_type, is_connected)
SELECT id, 'authorize_net', true FROM organizations WHERE slug = 'quarter-mile-inc'
ON CONFLICT DO NOTHING;
