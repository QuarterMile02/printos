-- ============================================================
-- Migration 166: seed the "Payment Received" email template.
-- Applied: PROPOSED, NOT run.
-- ============================================================
--
-- Same pattern as migration 052 (order_ready template) -- a real
-- seeded row, not a hardcoded string in the send action. trigger_event
-- 'payment_received' is new (distinct from the existing
-- 'payment_reminder', which is for an upcoming/overdue payment, not a
-- receipt for one already taken). department/ai_personalize/is_active
-- left to their column defaults ('{}', false, true), same as 052 did.

INSERT INTO email_templates (organization_id, name, trigger_event, subject, body)
SELECT
  id,
  'Payment Received',
  'payment_received',
  'Payment Received — #{{payment_number}}',
  E'Hi {{contact_name}},\n\nThank you! We''ve received your payment.\n\nPayment #: {{payment_number}}\nAmount: {{amount_paid}}\nMethod: {{payment_method}}\nDate: {{paid_on}}\n\nIf you have any questions about this payment, please don''t hesitate to reach out.\n\nThank you for your business!\n\nQuarter Mile, Inc.\n6420 Polaris Dr. Suite 4, Laredo, TX 78041\n(956) 722-7690'
FROM organizations
ON CONFLICT DO NOTHING;
