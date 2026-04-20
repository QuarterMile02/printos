-- Migration 011: Users, Roles & Permissions System
-- Adds role/tier/department to profiles, permission_overrides table,
-- activity_log table, and seeds QMI departments + Ruben's profile.

-- ============================================================
-- 1. ALTER profiles — add new columns
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'production'
    CHECK (role IN ('owner','sales','designer','production','installer','digital','accounting')),
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'staff'
    CHECK (tier IN ('staff','lead','manager')),
  ADD COLUMN IF NOT EXISTS departments text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS job_board_view text NOT NULL DEFAULT 'kanban'
    CHECK (job_board_view IN ('kanban','list')),
  ADD COLUMN IF NOT EXISTS job_board_date_range text NOT NULL DEFAULT 'next_3_days'
    CHECK (job_board_date_range IN ('today','next_3_days','this_week','custom')),
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- ============================================================
-- 2. CREATE permission_overrides table
-- ============================================================

CREATE TABLE IF NOT EXISTS permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  granted_by uuid REFERENCES profiles(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE(user_id, permission_key)
);

ALTER TABLE permission_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can view overrides" ON permission_overrides;
CREATE POLICY "org members can view overrides" ON permission_overrides
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "only owner or manager can manage overrides" ON permission_overrides;
CREATE POLICY "only owner or manager can manage overrides" ON permission_overrides
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND (role = 'owner' OR tier IN ('manager','lead'))
      AND organization_id = permission_overrides.organization_id
    )
  );

-- ============================================================
-- 3. ALTER departments — add missing columns
--    (table already exists from migration 010 with organization_id,
--     name, created_at, updated_at. We add code, sort_order, is_active.)
-- ============================================================

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Drop existing RLS policies and replace with spec policies
DROP POLICY IF EXISTS "org members can view departments" ON departments;
CREATE POLICY "org members can view departments" ON departments
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "only owner can manage departments" ON departments;
CREATE POLICY "only owner can manage departments" ON departments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role = 'owner'
      AND organization_id = departments.organization_id
    )
  );

-- Seed default departments for QMI org (upsert by name)
INSERT INTO departments (organization_id, name, code, sort_order) VALUES
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Large Format', 'large_format', 1),
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Commercial Print', 'commercial_print', 2),
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Vehicle Wrap', 'vehicle_wrap', 3),
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Channel Letters', 'channel_letters', 4),
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Fabrication', 'fabrication', 5),
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Installation', 'installation', 6),
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Service / Repair', 'service_repair', 7),
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Digital Marketing', 'digital_marketing', 8),
  ('4ca12dff-97be-4472-8099-ab102a3af01a', 'Digital Screens', 'digital_screens', 9)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. CREATE activity_log table
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  from_value text,
  to_value text,
  qr_scan_location text,
  equipment_name text,
  department_code text,
  duration_seconds int,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_org ON activity_log(organization_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org members can view activity" ON activity_log;
CREATE POLICY "org members can view activity" ON activity_log
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM profiles WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "system can insert activity" ON activity_log;
CREATE POLICY "system can insert activity" ON activity_log
  FOR INSERT WITH CHECK (true);

-- ============================================================
-- 5. Update Ruben's profile with correct role/tier/org
-- ============================================================

UPDATE profiles SET
  role = 'owner',
  tier = 'manager',
  departments = ARRAY['large_format','commercial_print','vehicle_wrap','channel_letters',
                       'fabrication','installation','service_repair','digital_marketing','digital_screens'],
  organization_id = '4ca12dff-97be-4472-8099-ab102a3af01a',
  title = 'President',
  phone = '(956) 722-7690'
WHERE id = 'f86f2712-ebcd-4faa-bccb-0f0580bcfeae';
