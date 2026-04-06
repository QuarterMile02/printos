'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole, QuoteStatus } from '@/types/database'

export type DeliveryMethod = 'email' | 'sms' | 'both'

const VALID_STATUSES: QuoteStatus[] = ['draft', 'sent', 'approved', 'declined']

type LineItemInput = {
  description: string
  quantity: number
  unit_price: number
}

export async function createQuote(
  orgId: string,
  orgSlug: string,
  data: {
    title: string
    customerId: string | null
    description: string | null
    lineItems: LineItemInput[]
  }
): Promise<{ error?: string }> {
  if (!data.title.trim()) return { error: 'Title is required.' }
  if (data.lineItems.length === 0) return { error: 'At least one line item is required.' }

  for (let i = 0; i < data.lineItems.length; i++) {
    const item = data.lineItems[i]
    if (!item.description.trim()) return { error: `Line item ${i + 1} needs a description.` }
    if (item.quantity < 1) return { error: `Line item ${i + 1} quantity must be at least 1.` }
    if (item.unit_price < 0) return { error: `Line item ${i + 1} unit price cannot be negative.` }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create quotes.' }

  const service = createServiceClient()

  // Insert quote — quote_number is set by trigger
  const { data: quote, error: quoteError } = await service
    .from('quotes')
    .insert({
      organization_id: orgId,
      customer_id: data.customerId || null,
      title: data.title.trim(),
      description: data.description?.trim() || null,
      status: 'draft' as QuoteStatus,
    })
    .select('id')
    .single()

  if (quoteError || !quote) return { error: quoteError?.message ?? 'Failed to create quote.' }

  // Insert line items
  const lineItemRows = data.lineItems.map((item, i) => ({
    quote_id: quote.id,
    description: item.description.trim(),
    quantity: item.quantity,
    unit_price: item.unit_price,
    sort_order: i,
  }))

  const { error: itemsError } = await service
    .from('quote_line_items')
    .insert(lineItemRows)

  if (itemsError) return { error: itemsError.message }

  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return {}
}

export async function updateQuoteStatus(
  quoteId: string,
  orgId: string,
  orgSlug: string,
  status: QuoteStatus
): Promise<{ error?: string; jobCreated?: number }> {
  if (!VALID_STATUSES.includes(status)) return { error: 'Invalid status.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update quotes.' }

  const service = createServiceClient()
  const { error: updateError } = await service
    .from('quotes')
    .update({ status })
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (updateError) return { error: updateError.message }

  // Auto-create job when quote is approved
  let jobCreated: number | undefined
  if (status === 'approved') {
    // Check if a job was already created from this quote
    const { data: existing } = await service
      .from('jobs')
      .select('id')
      .eq('source_quote_id', quoteId)
      .maybeSingle()

    if (!existing) {
      // Fetch quote details for the new job
      const { data: quote } = await service
        .from('quotes')
        .select('title, customer_id, quote_number')
        .eq('id', quoteId)
        .single() as { data: { title: string; customer_id: string | null; quote_number: number } | null; error: unknown }

      if (quote) {
        const { data: newJob } = await service
          .from('jobs')
          .insert({
            organization_id: orgId,
            customer_id: quote.customer_id,
            title: quote.title,
            description: `Auto-created from Quote #${quote.quote_number} on approval`,
            status: 'new' as const,
            source_quote_id: quoteId,
          })
          .select('job_number')
          .single() as { data: { job_number: number } | null; error: unknown }

        if (newJob) {
          jobCreated = newJob.job_number
          revalidatePath(`/dashboard/${orgSlug}/jobs`)
        }
      }
    }
  }

  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return { jobCreated }
}

export async function sendQuoteToCustomer(
  quoteId: string,
  orgId: string,
  orgSlug: string,
  method: DeliveryMethod
): Promise<{ error?: string; sent?: boolean }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot send quotes.' }

  const service = createServiceClient()

  // Fetch quote + customer + line items
  const { data: quote } = await service
    .from('quotes')
    .select('id, quote_number, title, description, status, customer_id')
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single() as { data: { id: string; quote_number: number; title: string; description: string | null; status: QuoteStatus; customer_id: string | null } | null; error: unknown }

  if (!quote) return { error: 'Quote not found.' }

  let customerEmail: string | null = null
  let customerPhone: string | null = null
  let customerName = 'Customer'

  if (quote.customer_id) {
    const { data: customer } = await service
      .from('customers')
      .select('first_name, last_name, email, phone')
      .eq('id', quote.customer_id)
      .single() as { data: { first_name: string; last_name: string; email: string | null; phone: string | null } | null; error: unknown }

    if (customer) {
      customerName = `${customer.first_name} ${customer.last_name}`
      customerEmail = customer.email
      customerPhone = customer.phone
    }
  }

  // Fetch line item total
  const { data: lineItems } = await service
    .from('quote_line_items')
    .select('quantity, unit_price')
    .eq('quote_id', quoteId) as { data: { quantity: number; unit_price: number }[] | null; error: unknown }

  const totalCents = (lineItems ?? []).reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const totalFormatted = (totalCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const errors: string[] = []

  // --- Email via Resend ---
  if (method === 'email' || method === 'both') {
    if (!customerEmail) {
      errors.push('Customer has no email address on file.')
    } else if (!process.env.RESEND_API_KEY) {
      errors.push('Email delivery not configured — RESEND_API_KEY is missing.')
    } else {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL ?? 'PrintOS <noreply@printos.app>',
            to: [customerEmail],
            subject: `Quote #${quote.quote_number} — ${quote.title}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px;">
                <h2 style="color: #1a1a1a;">Quote #${quote.quote_number}</h2>
                <p>Hi ${customerName},</p>
                <p>Here are the details for your quote:</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                  <tr>
                    <td style="padding: 8px 0; color: #666;">Title</td>
                    <td style="padding: 8px 0; font-weight: 600;">${quote.title}</td>
                  </tr>
                  ${quote.description ? `<tr><td style="padding: 8px 0; color: #666;">Description</td><td style="padding: 8px 0;">${quote.description}</td></tr>` : ''}
                  <tr>
                    <td style="padding: 8px 0; color: #666;">Total</td>
                    <td style="padding: 8px 0; font-weight: 600; font-size: 1.1em;">$${totalFormatted}</td>
                  </tr>
                </table>
                <p>To approve this quote, please give us a call and we'll get started right away.</p>
                <p style="color: #999; font-size: 0.85em; margin-top: 32px;">Sent via PrintOS</p>
              </div>
            `,
          }),
        })
        if (!res.ok) {
          const body = await res.text()
          errors.push(`Email failed: ${body}`)
        }
      } catch (e) {
        errors.push(`Email failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }
    }
  }

  // --- SMS via Twilio ---
  if (method === 'sms' || method === 'both') {
    if (!customerPhone) {
      errors.push('Customer has no phone number on file.')
    } else if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
      errors.push('SMS delivery not configured — Twilio credentials are missing.')
    } else {
      try {
        const sid = process.env.TWILIO_ACCOUNT_SID
        const token = process.env.TWILIO_AUTH_TOKEN
        const from = process.env.TWILIO_PHONE_NUMBER
        const body = `Hi ${customerName}, your quote Q-${quote.quote_number} for "${quote.title}" totaling $${totalFormatted} is ready. Call us to approve!`

        const params = new URLSearchParams({ To: customerPhone, From: from, Body: body })
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        })
        if (!res.ok) {
          const respBody = await res.text()
          errors.push(`SMS failed: ${respBody}`)
        }
      } catch (e) {
        errors.push(`SMS failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }
    }
  }

  if (errors.length > 0 && (
    (method === 'email' && errors.length >= 1) ||
    (method === 'sms' && errors.length >= 1) ||
    (method === 'both' && errors.length >= 2)
  )) {
    return { error: errors.join(' ') }
  }

  // Log delivery
  await service.from('quote_deliveries').insert({
    quote_id: quoteId,
    organization_id: orgId,
    method,
    sent_by: user.id,
    recipient_email: (method === 'email' || method === 'both') ? customerEmail : null,
    recipient_phone: (method === 'sms' || method === 'both') ? customerPhone : null,
    status: errors.length > 0 ? 'partial' : 'sent',
  })

  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return { sent: true, error: errors.length > 0 ? errors.join(' ') : undefined }
}
