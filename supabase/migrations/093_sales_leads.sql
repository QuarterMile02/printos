CREATE TABLE IF NOT EXISTS sales_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES customer_contacts(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  source TEXT,
  estimated_value NUMERIC(10,2),
  next_contact_date DATE,
  notes TEXT,
  so_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  lost_reason TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_org      ON sales_leads(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage    ON sales_leads(stage_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned ON sales_leads(assigned_to);

ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_sales_leads" ON sales_leads
  FOR ALL USING (org_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));

GRANT ALL ON sales_leads TO authenticated;
