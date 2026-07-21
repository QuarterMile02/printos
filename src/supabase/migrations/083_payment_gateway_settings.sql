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
