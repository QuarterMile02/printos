-- 039 — Dashboard layout customization (schema only — UI deferred)
--
-- Stores per-user widget config. The dashboard renders a default layout
-- when no row exists for (user_id, organization_id), so this migration
-- is non-breaking — existing users see the new dashboard immediately.
--
-- widget_config jsonb shape:
--   {
--     "version": 1,
--     "widgets": [
--       { "id": "alert_bar", "visible": true, "order": 0 },
--       { "id": "quick_create", "visible": true, "order": 1 },
--       ...
--     ]
--   }

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  widget_config   jsonb NOT NULL DEFAULT '{"version":1,"widgets":[]}'::jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

ALTER TABLE dashboard_layouts ENABLE ROW LEVEL SECURITY;

-- A user can read/write only their own layout for orgs they belong to.
DO $$ BEGIN
  CREATE POLICY dashboard_layouts_self_select ON dashboard_layouts FOR SELECT USING (
    user_id = auth.uid()
    AND organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY dashboard_layouts_self_write ON dashboard_layouts FOR ALL USING (
    user_id = auth.uid()
    AND organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
