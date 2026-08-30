'use server'

// Manual "Send Receipt" button for now -- automatic-on-payment is a
// later toggle, not built here. Reuses the existing email
// infrastructure exactly (Resend, email_templates, the recording
// user's own sender identity per Session 10) rather than building
// anything new: same getEmailTemplate/renderTemplate/
// getUserSenderIdentity/getSignatureHtmlForUser pattern already used
// by quotes' send-email action.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { getEmailTemplate, renderTemplate } from '@/app/actions/get-email-template'
import { getSignatureHtmlForUser } from '@/app/actions/email-signature'
import { getUserSenderIdentity, SYSTEM_FROM_EMAIL } from '@/lib/email-sender'

// Default-recipient resolution, split out so the post-record-payment
// confirmation step (RecordPaymentForm -> SendReceiptConfirm) can
// prefill an editable field with the same default sendPaymentReceipt
// would otherwise pick silently -- primary customer_contacts row for
// this customer, falling back to customers.email. Same precedence the
// quote send-email flow uses for its own default recipient.
export async function getDefaultReceiptRecipient(
  paymentId: string,
  orgId: string,
): Promise<{ email: string | null; error?: string }> {
  const { allowed } = await checkPermission(orgId, 'invoices.record_payment')
  if (!allowed) return { email: null, error: 'You do not have permission to send receipts.' }

  const service = createServiceClient()
  const { data: payment } = await service
    .from('payments')
    .select('customer_id')
    .eq('id', paymentId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { customer_id: string } | null }
  if (!payment) return { email: null, error: 'Payment not found.' }

  const { data: customer } = await service
    .from('customers')
    .select('email')
    .eq('id', payment.customer_id)
    .maybeSingle() as { data: { email: string | null } | null }

  const { data: primaryContact } = await service
    .from('customer_contacts')
    .select('email')
    .eq('customer_id', payment.customer_id)
    .eq('is_primary', true)
    .maybeSingle() as { data: { email: string | null } | null }

  return { email: primaryContact?.email ?? customer?.email ?? null }
}

export async function sendPaymentReceipt(
  paymentId: string,
  orgId: string,
  recipientOverride?: string,
): Promise<{ error?: string }> {
  const { allowed } = await checkPermission(orgId, 'invoices.record_payment')
  if (!allowed) return { error: 'You do not have permission to send receipts.' }

  if (!process.env.RESEND_API_KEY) {
    return { error: 'Email delivery not configured — RESEND_API_KEY is missing.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const service = createServiceClient()
  const { data: payment } = await service
    .from('payments')
    .select('payment_number, amount_paid, payment_method, paid_on, customer_id')
    .eq('id', paymentId)
    .eq('organization_id', orgId)
    .maybeSingle() as {
      data: { payment_number: number; amount_paid: number; payment_method: string; paid_on: string | null; customer_id: string } | null
    }
  if (!payment) return { error: 'Payment not found.' }

  const { data: customer } = await service
    .from('customers')
    .select('first_name, last_name, company_name, email')
    .eq('id', payment.customer_id)
    .maybeSingle() as { data: { first_name: string; last_name: string; company_name: string | null; email: string | null } | null }

  let recipientEmail: string | null = recipientOverride?.trim() || null
  if (!recipientEmail) {
    const { data: primaryContact } = await service
      .from('customer_contacts')
      .select('email')
      .eq('customer_id', payment.customer_id)
      .eq('is_primary', true)
      .maybeSingle() as { data: { email: string | null } | null }
    recipientEmail = primaryContact?.email ?? customer?.email ?? null
  }
  if (!recipientEmail) return { error: 'Customer has no email on file.' }

  const template = await getEmailTemplate(orgId, 'payment_received')
  if (!template) return { error: 'No "Payment Received" email template is configured for this org.' }

  const vars = {
    contact_name: customer?.company_name ?? (customer ? `${customer.first_name} ${customer.last_name}`.trim() : 'there'),
    payment_number: String(payment.payment_number),
    amount_paid: `$${(payment.amount_paid / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    payment_method: payment.payment_method,
    paid_on: payment.paid_on ?? '',
  }

  const subject = await renderTemplate(template.subject, vars)
  const bodyText = await renderTemplate(template.body, vars)
  const bodyHtml = `<div style="font-family: sans-serif; max-width: 600px; white-space: pre-wrap;">${bodyText.replace(/\n/g, '<br>')}</div>`
  const sigHtml = await getSignatureHtmlForUser(user.id, orgId)

  const fromHeader = user.email
    ? await getUserSenderIdentity(service, user.id, user.email, orgId)
    : SYSTEM_FROM_EMAIL

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromHeader,
        to: [recipientEmail],
        subject,
        html: bodyHtml + sigHtml,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      return { error: `Email failed: ${body}` }
    }
  } catch (e) {
    return { error: `Email failed: ${e instanceof Error ? e.message : 'Unknown error'}` }
  }

  return {}
}
