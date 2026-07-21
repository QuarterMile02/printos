CREATE TABLE IF NOT EXISTS org_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
  legal_name text,
  dba_name text,
  phone text,
  email text,
  website text,
  street text,
  city text,
  state text,
  zip text,
  country text DEFAULT 'US',
  tax_id text,
  logo_url text,
  tagline text,
  footer_note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE org_profile ENABLE ROW LEVEL SECURITY;
GRANT ALL ON org_profile TO authenticated, service_role;
CREATE POLICY "org members can manage org profile" ON org_profile FOR ALL TO authenticated
  USING (organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid()));

INSERT INTO org_profile (organization_id, legal_name, dba_name, phone, email, website, street, city, state, zip, country)
SELECT id, 'Quarter Mile Inc.', 'Quarter Mile Inc.', '(956) 724-4000', 'info@quartermileinc.com',
'https://quartermileinc.com', '6420 Polaris Dr Ste 4', 'Laredo', 'TX', '78041', 'US'
FROM organizations WHERE slug = 'quarter-mile-inc'
ON CONFLICT DO NOTHING;
