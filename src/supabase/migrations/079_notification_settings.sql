CREATE TABLE IF NOT EXISTS notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_group text NOT NULL,
  event_name text NOT NULL,
  channel_email boolean DEFAULT false,
  channel_sms boolean DEFAULT false,
  channel_inapp boolean DEFAULT true,
  notify_sales_rep boolean DEFAULT false,
  notify_production_manager boolean DEFAULT false,
  notify_assignee boolean DEFAULT false,
  notify_designer boolean DEFAULT false,
  notify_roles text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(organization_id, event_group, event_name)
);

ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

GRANT ALL ON notification_settings TO authenticated, service_role;

CREATE POLICY "org members can manage notification settings"
  ON notification_settings FOR ALL TO authenticated
  USING (organization_id IN (
    SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
  ));
