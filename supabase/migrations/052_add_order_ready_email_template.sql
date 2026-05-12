INSERT INTO email_templates (
  organization_id,
  name,
  subject,
  trigger_event,
  body,
  is_active
)
SELECT
  id,
  'Order Ready for Pickup',
  'Your order is ready for pickup! 🎉',
  'order_ready',
  '<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; color: #1A1A1A; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #93ca3b; padding: 16px 24px; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 20px;">Your Order is Ready! 🎉</h1>
  </div>
  <div style="background: #f8f8f8; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #eee;">
    <p>Hi {{customer_name}},</p>
    <p>Great news — your order <strong>{{order_number}}</strong> is ready for pickup at our shop!</p>
    <p><strong>What to bring:</strong> Just your name or order number and we will take care of the rest.</p>
    <p>If you have any questions, reply to this email or give us a call.</p>
    <p>Thank you for choosing Quarter Mile Inc.!</p>
    <p style="margin-top: 32px; color: #989899; font-size: 13px;">Quarter Mile Inc. | Laredo, TX</p>
  </div>
</body>
</html>',
  true
FROM organizations
WHERE TRUE
ON CONFLICT DO NOTHING;
