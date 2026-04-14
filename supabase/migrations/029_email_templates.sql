-- Phase 15: Email templates

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  trigger_event text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY et_select_members ON email_templates FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY et_insert_non_viewers ON email_templates FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role <> 'viewer')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY et_update_non_viewers ON email_templates FOR UPDATE USING (
    organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = auth.uid() AND role <> 'viewer')
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_email_templates_org ON email_templates(organization_id);

-- Seed QMI templates (only if org exists)
DO $$
DECLARE
  qmi_org_id uuid;
BEGIN
  SELECT id INTO qmi_org_id FROM organizations WHERE slug = 'quarter-mile-inc' LIMIT 1;
  IF qmi_org_id IS NOT NULL THEN
    INSERT INTO email_templates (organization_id, name, subject, body, trigger_event) VALUES
    (qmi_org_id, 'Quote Review — Deposit Required', 'The quote you requested - Quote #{{txn_number}}', E'Hi {{contact_name}} –\n\nWe''re excited to start working on your project. Your quote is ready to review.\n\nWe require a 60% deposit on all orders. Click Approve to get started.', 'quote_sent'),
    (qmi_org_id, 'Quote Revised — Deposit Required', 'Revised quote - Quote #{{txn_number}}', E'Dear {{contact_name}},\n\nYour revised quote is ready. Please review and approve when ready to proceed.\n\nWe require a 60% deposit to begin.', 'quote_revised'),
    (qmi_org_id, 'Payment Reminder', 'Payment Reminder - Invoice #{{txn_number}}', E'Hi {{contact_name}},\n\nThis is a friendly reminder that payment is due on your invoice. Please let us know if you have any questions.', 'payment_reminder'),
    (qmi_org_id, 'Proof Ready for Review', 'Your proof is ready - {{job_name}}', E'Hi {{contact_name}},\n\nYour proof is ready for review. Please log in to approve or request changes.\n\nWe cannot proceed to production until we receive your approval.', 'proof_sent'),
    (qmi_org_id, 'Order Confirmation', 'Order Confirmed - {{txn_number}}', E'Hi {{contact_name}},\n\nGreat news — your order has been confirmed and is now in production.\n\nWe will notify you when your order is ready.', 'order_confirmed'),
    (qmi_org_id, 'Order Ready for Pickup', 'Your order is ready - {{txn_number}}', E'Hi {{contact_name}},\n\nYour order is complete and ready for pickup at our location.\n\nPlease bring this email as reference.', 'order_ready'),
    (qmi_org_id, 'Invoice', 'Invoice #{{txn_number}} from Quarter Mile Inc.', E'Hi {{contact_name}},\n\nPlease find your invoice attached. Payment is due within 30 days.\n\nThank you for your business.', 'invoice_sent')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
