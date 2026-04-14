-- Phase 15: Email templates — create table and seed all 25 QMI templates

CREATE TABLE IF NOT EXISTS email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  trigger_event text NOT NULL DEFAULT 'manual',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "org members can manage email templates"
    ON email_templates FOR ALL
    USING (organization_id IN (
      SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_email_templates_org ON email_templates(organization_id);

-- Seed all 25 QMI templates
DO $$
DECLARE
  org_id uuid;
BEGIN
  SELECT id INTO org_id FROM organizations LIMIT 1;
  IF org_id IS NULL THEN RETURN; END IF;

  INSERT INTO email_templates (organization_id, name, subject, body, trigger_event) VALUES

  (org_id, 'Quote Review- Deposit Required', 'Your Quote is Ready for Review – {{txn_number}}',
  E'Hi {{contact_name}},\n\nThank you for the opportunity to work with you. Your quote {{txn_number}} is ready for your review.\n\nPlease review the details and let us know if you have any questions. A deposit is required to move forward with your order.\n\nClick the link below to review and approve your quote:\n{{quote_link}}\n\nThank you for your business!\n\nQuarter Mile, Inc.\n6420 Polaris Dr. Suite 4, Laredo, TX 78041\n(956) 722-7690', 'quote_sent'),

  (org_id, 'Quote Revised- Deposit Required', 'Your Quote Has Been Updated – {{txn_number}}',
  E'Hi {{contact_name}},\n\nWe have revised your quote {{txn_number}} based on your feedback. Please review the updated details.\n\nA deposit is required to confirm your order. Click the link below to review:\n{{quote_link}}\n\nThank you,\nQuarter Mile, Inc.', 'quote_revised'),

  (org_id, 'Quote Reminder- Deposit Required', 'Reminder: Your Quote is Awaiting Approval – {{txn_number}}',
  E'Hi {{contact_name}},\n\nThis is a friendly reminder that your quote {{txn_number}} is still awaiting your approval and deposit.\n\nPlease click the link below to review and confirm:\n{{quote_link}}\n\nIf you have any questions, feel free to reach out. We look forward to working with you!\n\nQuarter Mile, Inc.\n(956) 722-7690', 'quote_reminder'),

  (org_id, 'Permit Information Required', 'Permit Information Required for Your Project – {{txn_number}}',
  E'Hi {{contact_name}},\n\nWe are moving forward with your project {{txn_number}} and need to obtain the necessary permits before installation.\n\nTo proceed, we will need the following information from you:\n- Property owner name and contact information\n- Site address and parcel number\n- Any HOA or landlord approval documents\n\nPlease reply to this email or contact us at (956) 722-7690 at your earliest convenience so we can keep your project on schedule.\n\nThank you,\nQuarter Mile, Inc.', 'permit_required'),

  (org_id, 'Payment Reminder', 'Payment Reminder – Invoice {{txn_number}}',
  E'Hi {{contact_name}},\n\nThis is a friendly reminder that payment for invoice {{txn_number}} is due.\n\nFor your convenience, you can submit payment in the following ways:\n- Zelle: accounting@quartermileinc.com\n- Check: 6420 Polaris Dr. Ste #4, Laredo, TX 78041\n- Online: Click the payment link in your invoice\n- Phone: Call (956) 722-7690\n\nIf you have already submitted payment, please disregard this message. Thank you!\n\nQuarter Mile, Inc.', 'payment_reminder'),

  (org_id, 'Proof Reminder', 'Reminder: Your Proof is Awaiting Approval – {{txn_number}}',
  E'Hi {{contact_name}},\n\nYour proof for {{txn_number}} is ready and waiting for your approval. Please review and approve so we can move forward with production.\n\n{{proof_link}}\n\nIf you have any questions or revisions, please let us know.\n\nThank you,\nQuarter Mile, Inc.', 'proof_reminder'),

  (org_id, 'Ask for Feedback', 'How Did We Do? – {{txn_number}}',
  E'Hi {{contact_name}},\n\nWe hope you are thrilled with your recent order from Quarter Mile, Inc.! Your satisfaction is our top priority, and we would love to hear about your experience.\n\nCould you take a moment to share your feedback? It helps us continue to improve and serve you better.\n\nThank you for your business and we look forward to working with you again!\n\nQuarter Mile, Inc.', 'job_complete'),

  (org_id, 'Ask for Referral', 'Know Someone Who Could Use Our Services?',
  E'Hi {{contact_name}},\n\nWe are so glad we could help with your recent project! If you know anyone who could benefit from our sign, print, or marketing services, we would love to be introduced.\n\nReferrals are the highest compliment we can receive. Thank you for trusting Quarter Mile, Inc. with your business.\n\nQuarter Mile, Inc.\n(956) 722-7690', 'job_complete'),

  (org_id, 'Ask for Testimonial', 'Would You Share Your Experience? – Quarter Mile, Inc.',
  E'Hi {{contact_name}},\n\nThank you for choosing Quarter Mile, Inc.! We truly value your business and hope your experience exceeded expectations.\n\nWould you be willing to leave us a quick review? It means the world to our small team and helps other businesses find us.\n\nThank you so much,\nQuarter Mile, Inc.', 'job_complete'),

  (org_id, 'Statement of Invoices', 'Account Statement – Quarter Mile, Inc.',
  E'Hi {{contact_name}},\n\nPlease find attached your current account statement showing all outstanding invoices.\n\nIf you have any questions about your balance or would like to discuss payment arrangements, please contact us at (956) 722-7690 or accounting@quartermileinc.com.\n\nThank you for your continued business!\n\nQuarter Mile, Inc.', 'statement'),

  (org_id, 'Quote Review- Terms', 'Your Quote is Ready for Review – {{txn_number}}',
  E'Hi {{contact_name}},\n\nYour quote {{txn_number}} is ready for your review. Please look over the details, including our terms and conditions, and let us know if you have any questions.\n\nClick below to review and approve:\n{{quote_link}}\n\nThank you,\nQuarter Mile, Inc.', 'quote_sent'),

  (org_id, 'Quote Revised- Terms', 'Your Quote Has Been Updated – {{txn_number}}',
  E'Hi {{contact_name}},\n\nWe have updated your quote {{txn_number}}. Please review the revised details and updated terms at your earliest convenience.\n\n{{quote_link}}\n\nQuarter Mile, Inc.', 'quote_revised'),

  (org_id, 'Quote Reminder- Terms', 'Reminder: Your Quote is Awaiting Approval – {{txn_number}}',
  E'Hi {{contact_name}},\n\nJust a reminder that your quote {{txn_number}} is still pending your approval. Please review the terms and confirm when ready.\n\n{{quote_link}}\n\nQuarter Mile, Inc.', 'quote_reminder'),

  (org_id, 'Sales Order Confirmation', 'Sales Order Confirmed – {{txn_number}}',
  E'Hi {{contact_name}},\n\nGreat news! Your sales order {{txn_number}} has been confirmed and is now in production.\n\nWe will keep you updated on the progress of your order. If you have any questions in the meantime, please do not hesitate to reach out.\n\nThank you for your business!\n\nQuarter Mile, Inc.\n6420 Polaris Dr. Suite 4, Laredo, TX 78041\n(956) 722-7690', 'order_confirmed'),

  (org_id, 'Proof Review', 'Your Proof is Ready for Review – {{txn_number}}',
  E'Hi {{contact_name}},\n\nYour proof for {{txn_number}} is ready! Please review the attached proof carefully and let us know if you approve or if you would like any changes.\n\n{{proof_link}}\n\nPlease note that production will not begin until we receive your approval. Your prompt response helps us stay on schedule.\n\nThank you,\nQuarter Mile, Inc.', 'proof_sent'),

  (org_id, 'Proof Revision Message', 'Proof Revised – {{txn_number}}',
  E'Hi {{contact_name}},\n\nWe have updated the proof for {{txn_number}} based on your feedback. Please review the revised version:\n\n{{proof_link}}\n\nLet us know if you approve or if any further changes are needed. Thank you for your patience!\n\nQuarter Mile, Inc.', 'proof_revised'),

  (org_id, 'Deposit Payment Receipt', 'Deposit Received – Thank You! – {{txn_number}}',
  E'Hi {{contact_name}},\n\nWe have received your deposit for {{txn_number}}. Thank you!\n\nYour order is now confirmed and we will be in touch with updates as production moves forward.\n\nIf you have any questions, please contact us at (956) 722-7690.\n\nThanks again,\nQuarter Mile, Inc.', 'deposit_received'),

  (org_id, 'Invoice', 'Invoice #{{txn_number}} - thanks for your business!',
  E'Hello {{contact_name}} –\n\nEvery good thing must come to an end.\n\nWe were thrilled that we could help you with your project, and hope that you are 110%% satisfied with your experience and the final results.\n\nAttached is a copy of your final invoice showing your balance due.\n\nFor your convenience, you can submit payment in the following ways:\n\nZelle Payments use the following email: accounting@quartermileinc.com\nChecks can be mail or dropped off at 6420 Polaris Dr. Ste #4, Laredo, TX 78041\nClick on the payment link to pay online via credit card\nCall our office, and we''ll gladly assist with credit card payments over the phone\n\nThank you for your business and we look forward to working with you again soon.\n\nThanks!', 'invoice_sent'),

  (org_id, 'Fee Notification Email', 'Implementation of Administrative Fee on All Transactions',
  E'Dear Valued Customer,\n\nWe hope this letter finds you well. We greatly appreciate your continued support and partnership with Quarter Mile, Inc. We are writing to inform you of an important update regarding our pricing structure.\n\nEffective June 1, 2023, we will be implementing an administrative fee on all transactions. This administrative fee is necessary to cover the increasing costs associated with the administrative tasks and processes involved in serving our valued customers such as yourself.\n\nThe administrative fee will be a percentage of each transaction and will be clearly outlined on your invoice. It is important to note that this fee will be applicable to all transactions made with Quarter Mile, Inc. starting on June 1, 2023.\n\nWe understand that any adjustment to pricing may raise questions. We want to assure you that we have carefully considered this decision and believe it is necessary to maintain the level of service and quality you expect from us. The administrative fee will allow us to continue delivering exceptional products and services while ensuring efficiency and sustainability in our operations.\n\nWe value your partnership and want to maintain transparency in our business practices. Should you have any questions or require further clarification regarding the administrative fee, please do not hesitate to reach out to our dedicated customer support team. We will be more than happy to assist you.\n\nThank you for your understanding and continued support. We look forward to serving you and providing you with the best possible experience.\n\nSincerely,\nRuben Reyes\nCEO\nQuarter Mile, Inc.\n6420 Polaris Dr. Suite 4\nLaredo, TX 78041', 'manual'),

  (org_id, 'Purchase Order', 'Purchase Order Confirmation and Receipt Required {{txn_number}}',
  E'Hi {{contact_name}} –,\n\nI hope this email finds you well. Please find attached our purchase order detailing the materials we require.\n\nI kindly request that you carefully review the pricing on the purchase order. If you identify any price discrepancies, I would appreciate it if you could reach out to me before proceeding with the order. This step ensures that we''re on the same page and can avoid any misunderstandings.\n\nOn the other hand, please proceed with the order and kindly confirm once you have received the purchase order.\n\nThank you for your cooperation and prompt attention to these matters. Feel free to contact me at (956) 722-7690 if you have any questions or concerns.\n\nLooking forward to your confirmation.', 'purchase_order'),

  (org_id, 'Domain & Hosting Renewal Invoice', 'Domain & Hosting Renewal Invoice {{txn_number}}',
  E'Hello {{contact_name}},\n\nI hope you''re doing well! We wanted to give you a heads-up that your domain and hosting renewal is coming up soon.\n\nDomain: This is the web address people use to find your website (e.g., www.yourcompany.com).\nHosting: This service keeps your website live on the internet so visitors can access it.\nEmail Services: If you use your domain for professional email (e.g., info@yourcompany.com), this is also tied to your hosting plan.\n\nScam/Fraud Alert:\nPlease be aware that companies like Google or other service providers will never call, email, or mail you unsolicited renewal notices. If you receive anything like this, it could be a scam. Always verify with us before taking any action.\n\nAttached is a copy of your invoice. Payment options:\n- Zelle: accounting@quartermileinc.com\n- Check: 6420 Polaris Dr. Ste #4, Laredo, TX 78041\n- Online: Click the payment link\n- Phone: (956) 722-7690\n\nBest regards,\nQuarter Mile, Inc.', 'invoice_sent'),

  (org_id, 'Customer Appointment Email', 'Your Appointment with {{account_name}} is Confirmed!',
  E'Hi {{contact_name}},\n\nThank you for scheduling an appointment with {{account_name}}. We''re excited to work with you on {{txn_number}} - {{txn_name}}.\n\nHere are your appointment details:\nDate: {{task_date}}\nTime: {{task_time}}\n\nYou can add this event to your calendar by clicking the attached calendar invite.\n\nIf you have any questions or need to make changes, feel free to reach out at {{account_email}} or {{account_phone}}.\n\nWe look forward to seeing you soon!', 'appointment'),

  (org_id, 'Customer Installation/Service Appointment Email', 'Installation Appointment Scheduled - [{{txn_number}}]',
  E'Hi {{contact_name}},\n\nYour installation appointment for {{txn_number}} has been scheduled!\n\nDate: {{task_date}}\nTime: {{task_time}}\n\nYou can add this event to your calendar by clicking the attached calendar invite.\n\nIf you have any questions or need to make changes, feel free to reach out at {{account_email}} or {{account_phone}}.\n\nLooking forward to a successful install!', 'appointment'),

  (org_id, 'Artwork Quality Verification', 'Artwork Quality Verification – Action Needed',
  E'Hi {{contact_name}},\n\nUpon closer examination of the artwork, we observed that the resolution appears to be low. This may affect the print quality and could result in a lack of sharpness in the final product.\n\nTo ensure your complete satisfaction with the outcome, please let us know if you would like to proceed with the current files or if you prefer to provide higher-resolution versions.\n\nWe are happy to assist with any updates you may require.\n\nBest regards,\nQuarter Mile Inc.', 'manual'),

  (org_id, 'Send Purchase Order to Supplier/Vendor Contact', 'Purchase Order – {{txn_number}}',
  E'Hi {{contact_name}},\n\nPlease find attached the purchase order {{txn_number}} for your records. Kindly review and confirm receipt at your earliest convenience.\n\nIf you have any questions, please contact us at (956) 722-7690.\n\nThank you,\nQuarter Mile, Inc.', 'purchase_order')

  ON CONFLICT DO NOTHING;

END $$;
