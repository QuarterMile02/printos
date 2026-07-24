-- Task types table (org-defined, reusable)
CREATE TABLE IF NOT EXISTS task_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_concept BOOLEAN NOT NULL DEFAULT false,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_task_types" ON task_types
  FOR ALL USING (org_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
GRANT ALL ON task_types TO authenticated;

-- Add concept columns to tasks table
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_type_id UUID REFERENCES task_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS concept_status TEXT CHECK (concept_status IN ('pending','in_progress','waiting_on_customer','approved','declined','completed')),
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS departments TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_sample_work_order BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sample_work_order_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_to_quote_at TIMESTAMPTZ;

-- Sample work orders table (lightweight jobs, no SO, $0 cost)
CREATE TABLE IF NOT EXISTS sample_work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
  departments TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  notes TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE sample_work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_sample_work_orders" ON sample_work_orders
  FOR ALL USING (org_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
GRANT ALL ON sample_work_orders TO authenticated;
