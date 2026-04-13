'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole, QuoteStatus } from '@/types/database'
import { TAX_RATE } from './format'

type ServiceClient = ReturnType<typeof createServiceClient>

// Sums all line items for a quote and writes subtotal/tax_total/total
// back to the quotes row in cents. Tax is applied only to taxable items
// at the Laredo TX rate. Called after every line-item mutation.
async function recalcQuoteTotals(service: ServiceClient, quoteId: string): Promise<void> {
  const { data: items } = await service
    .from('quote_line_items')
    .select('quantity, unit_price, discount_percent, taxable, total_price')
    .eq('quote_id', quoteId) as {
      data: {
        quantity: number
        unit_price: number
        discount_percent: number | null
        taxable: boolean | null
        total_price: number | null
      }[] | null
      error: unknown
    }

  let subtotal = 0
  let taxableSubtotal = 0
  for (const i of items ?? []) {
    const gross = (i.quantity ?? 0) * (i.unit_price ?? 0)
    const discounted = gross * (1 - (Number(i.discount_percent ?? 0) / 100))
    const lineTotal = Math.round(discounted)
    subtotal += lineTotal
    if (i.taxable !== false) taxableSubtotal += lineTotal
  }
  const tax = Math.round(taxableSubtotal * TAX_RATE)
  const total = subtotal + tax

  await service
    .from('quotes')
    .update({ subtotal, tax_total: tax, total })
    .eq('id', quoteId)
}

export type DeliveryMethod = 'email' | 'sms' | 'both'

// All non-legacy statuses are valid for direct manual update. The legacy
// 'sent' and 'declined' values still exist in the enum but Phase 8 code
// should not write them, so they're excluded here.
const VALID_STATUSES: QuoteStatus[] = [
  'draft', 'delivered', 'customer_review', 'approved', 'approve_with_changes',
  'revise', 'ordered', 'hold', 'expired', 'lost', 'pending', 'no_charge',
]

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
    expiresAt: string | null
    terms: string | null
    notes: string | null
    dueDate: string | null
    salesRepId: string | null
    poNumber: string | null
    installAddress: string | null
    productionNotes: string | null
    lineItems: LineItemInput[]
  }
): Promise<{ error?: string; quoteId?: string }> {
  if (!data.title.trim()) return { error: 'Title is required.' }

  // Phase 8: line items are now optional at creation. Users can add them
  // on the detail page after the quote is created.
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
  const insert: Record<string, unknown> = {
    organization_id: orgId,
    customer_id: data.customerId || null,
    title: data.title.trim(),
    description: data.description?.trim() || null,
    expires_at: data.expiresAt || null,
    terms: data.terms?.trim() || null,
    notes: data.notes?.trim() || null,
    status: 'draft' as QuoteStatus,
  }
  if (data.dueDate)         insert.due_date = data.dueDate
  if (data.salesRepId)      insert.sales_rep_id = data.salesRepId
  if (data.poNumber)        insert.po_number = data.poNumber.trim()
  if (data.installAddress)  insert.install_address = data.installAddress.trim()
  if (data.productionNotes) insert.production_notes = data.productionNotes.trim()

  const { data: quote, error: quoteError } = await service
    .from('quotes')
    .insert(insert)
    .select('id')
    .single()

  if (quoteError || !quote) return { error: quoteError?.message ?? 'Failed to create quote.' }

  if (data.lineItems.length > 0) {
    const lineItemRows = data.lineItems.map((item, i) => ({
      quote_id: quote.id,
      description: item.description.trim(),
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: item.quantity * item.unit_price,
      sort_order: i,
    }))

    const { error: itemsError } = await service
      .from('quote_line_items')
      .insert(lineItemRows)

    if (itemsError) return { error: itemsError.message }

    // Sync subtotal/total on the quote row.
    await recalcQuoteTotals(service, quote.id)
  }

  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return { quoteId: quote.id }
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

// ──────────────────────────────────────────────────────────────────────
// Phase 8 — quote field & line item CRUD + status auto-transitions
// ──────────────────────────────────────────────────────────────────────

async function getServiceWithMembership(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' as const }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership) return { error: 'You are not a member of this organization.' as const }
  if (membership.role === 'viewer') return { error: 'Viewers cannot modify quotes.' as const }
  return { user, service: createServiceClient() }
}

export async function updateQuoteFields(
  quoteId: string,
  orgId: string,
  orgSlug: string,
  fields: {
    expires_at?: string | null
    terms?: string | null
    notes?: string | null
    title?: string
    due_date?: string | null
    sales_rep_id?: string | null
    po_number?: string | null
    install_address?: string | null
    production_notes?: string | null
  }
): Promise<{ error?: string }> {
  const ctx = await getServiceWithMembership(orgId)
  if ('error' in ctx) return { error: ctx.error }

  const update: Record<string, unknown> = {}
  if (fields.expires_at !== undefined)       update.expires_at = fields.expires_at
  if (fields.terms !== undefined)            update.terms = fields.terms
  if (fields.notes !== undefined)            update.notes = fields.notes
  if (fields.title !== undefined && fields.title.trim()) update.title = fields.title.trim()
  if (fields.due_date !== undefined)         update.due_date = fields.due_date
  if (fields.sales_rep_id !== undefined)     update.sales_rep_id = fields.sales_rep_id
  if (fields.po_number !== undefined)        update.po_number = fields.po_number
  if (fields.install_address !== undefined)  update.install_address = fields.install_address
  if (fields.production_notes !== undefined) update.production_notes = fields.production_notes
  if (Object.keys(update).length === 0) return {}

  const { error } = await ctx.service
    .from('quotes')
    .update(update)
    .eq('id', quoteId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  return {}
}

export type LineItemDraft = {
  product_id: string | null
  description: string
  width: number | null
  height: number | null
  quantity: number
  unit_price: number      // cents
  discount_percent: number
  taxable: boolean
}

export async function addQuoteLineItem(
  quoteId: string,
  orgId: string,
  orgSlug: string,
  draft: LineItemDraft,
): Promise<{ error?: string; id?: string }> {
  if (!draft.description.trim()) return { error: 'Description is required.' }
  if (draft.quantity < 1) return { error: 'Quantity must be at least 1.' }
  if (draft.unit_price < 0) return { error: 'Unit price cannot be negative.' }
  if (draft.discount_percent < 0 || draft.discount_percent > 100) {
    return { error: 'Discount must be between 0 and 100.' }
  }

  const ctx = await getServiceWithMembership(orgId)
  if ('error' in ctx) return { error: ctx.error }

  // Verify the quote belongs to this org before mutating any children.
  const { data: quote } = await ctx.service
    .from('quotes')
    .select('id')
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!quote) return { error: 'Quote not found.' }

  // Compute line total in cents.
  const gross = draft.quantity * draft.unit_price
  const total = Math.round(gross * (1 - draft.discount_percent / 100))

  // sort_order = max + 1
  const { data: existing } = await ctx.service
    .from('quote_line_items')
    .select('sort_order')
    .eq('quote_id', quoteId)
    .order('sort_order', { ascending: false })
    .limit(1) as { data: { sort_order: number | null }[] | null; error: unknown }
  const nextSort = (existing?.[0]?.sort_order ?? -1) + 1

  const { data: inserted, error } = await ctx.service
    .from('quote_line_items')
    .insert({
      quote_id: quoteId,
      product_id: draft.product_id,
      description: draft.description.trim(),
      width: draft.width,
      height: draft.height,
      quantity: draft.quantity,
      unit_price: draft.unit_price,
      discount_percent: draft.discount_percent,
      total_price: total,
      taxable: draft.taxable,
      sort_order: nextSort,
    })
    .select('id')
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (error) return { error: error.message }

  await recalcQuoteTotals(ctx.service, quoteId)
  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  return { id: inserted?.id }
}

export async function updateQuoteLineItem(
  itemId: string,
  quoteId: string,
  orgId: string,
  orgSlug: string,
  fields: Partial<LineItemDraft>,
): Promise<{ error?: string }> {
  const ctx = await getServiceWithMembership(orgId)
  if ('error' in ctx) return { error: ctx.error }

  // Pull the current row so we can recompute total_price from a mix of
  // old + new fields without forcing the client to round-trip everything.
  const { data: current, error: fetchErr } = await ctx.service
    .from('quote_line_items')
    .select('quote_id, quantity, unit_price, discount_percent')
    .eq('id', itemId)
    .single() as {
      data: { quote_id: string; quantity: number; unit_price: number; discount_percent: number | null } | null
      error: { message: string } | null
    }
  if (fetchErr || !current) return { error: fetchErr?.message ?? 'Line item not found.' }
  if (current.quote_id !== quoteId) return { error: 'Line item does not belong to this quote.' }

  const merged = {
    quantity:         fields.quantity         ?? current.quantity,
    unit_price:       fields.unit_price       ?? current.unit_price,
    discount_percent: fields.discount_percent ?? Number(current.discount_percent ?? 0),
  }
  const total = Math.round(merged.quantity * merged.unit_price * (1 - merged.discount_percent / 100))

  const update: Record<string, unknown> = { total_price: total }
  if (fields.product_id       !== undefined) update.product_id       = fields.product_id
  if (fields.description      !== undefined) update.description      = fields.description.trim()
  if (fields.width            !== undefined) update.width            = fields.width
  if (fields.height           !== undefined) update.height           = fields.height
  if (fields.quantity         !== undefined) update.quantity         = fields.quantity
  if (fields.unit_price       !== undefined) update.unit_price       = fields.unit_price
  if (fields.discount_percent !== undefined) update.discount_percent = fields.discount_percent
  if (fields.taxable          !== undefined) update.taxable          = fields.taxable

  const { error } = await ctx.service
    .from('quote_line_items')
    .update(update)
    .eq('id', itemId)

  if (error) return { error: error.message }

  await recalcQuoteTotals(ctx.service, quoteId)
  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  return {}
}

export async function deleteQuoteLineItem(
  itemId: string,
  quoteId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const ctx = await getServiceWithMembership(orgId)
  if ('error' in ctx) return { error: ctx.error }

  // Verify ownership through the join before deleting.
  const { data: item } = await ctx.service
    .from('quote_line_items')
    .select('quote_id, quotes!inner(organization_id)')
    .eq('id', itemId)
    .maybeSingle() as { data: { quote_id: string; quotes: { organization_id: string } } | null; error: unknown }
  if (!item || item.quote_id !== quoteId || item.quotes.organization_id !== orgId) {
    return { error: 'Line item not found.' }
  }

  const { error } = await ctx.service
    .from('quote_line_items')
    .delete()
    .eq('id', itemId)

  if (error) return { error: error.message }

  await recalcQuoteTotals(ctx.service, quoteId)
  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  return {}
}

// Send the quote SMS AND auto-transition draft → delivered.
// Mirrors sendQuoteEmailAndDeliver but uses the SMS path.
export async function sendQuoteSmsAndDeliver(
  quoteId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const result = await sendQuoteToCustomer(quoteId, orgId, orgSlug, 'sms')
  if (result.error && !result.sent) return { error: result.error }

  const ctx = await getServiceWithMembership(orgId)
  if ('error' in ctx) return { error: ctx.error }

  const { error } = await ctx.service
    .from('quotes')
    .update({ status: 'delivered' as QuoteStatus })
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .eq('status', 'draft')

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return {}
}

// Send the quote email AND auto-transition draft → delivered.
// Reuses the existing sendQuoteToCustomer (email path) so we don't
// duplicate the Resend integration.
export async function sendQuoteEmailAndDeliver(
  quoteId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const result = await sendQuoteToCustomer(quoteId, orgId, orgSlug, 'email')
  if (result.error && !result.sent) return { error: result.error }

  const ctx = await getServiceWithMembership(orgId)
  if ('error' in ctx) return { error: ctx.error }

  const { error } = await ctx.service
    .from('quotes')
    .update({ status: 'delivered' as QuoteStatus })
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .eq('status', 'draft')

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return {}
}

// Send "for review" email and auto-transition delivered → customer_review.
// For now this reuses the same email body — when QMI wants a different
// template (with approve/decline links), swap in a dedicated send action.
export async function sendForReviewAndUpdate(
  quoteId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const result = await sendQuoteToCustomer(quoteId, orgId, orgSlug, 'email')
  if (result.error && !result.sent) return { error: result.error }

  const ctx = await getServiceWithMembership(orgId)
  if ('error' in ctx) return { error: ctx.error }

  const { error } = await ctx.service
    .from('quotes')
    .update({ status: 'customer_review' as QuoteStatus })
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .in('status', ['delivered', 'draft'])

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  revalidatePath(`/dashboard/${orgSlug}/quotes`)
  return {}
}

// Convert quote → sales order. Creates a sales_orders row (so_number
// assigned by trigger), links it back via quotes.converted_to_so_id,
// and flips the quote status to 'ordered'.
export async function convertQuoteToSalesOrder(
  quoteId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string; soNumber?: number; soId?: string; createdAt?: string }> {
  console.log('[convertQuoteToSalesOrder] Starting conversion', { quoteId, orgId, orgSlug })
  try {
    const ctx = await getServiceWithMembership(orgId)
    if ('error' in ctx) {
      console.error('[convertQuoteToSalesOrder] Auth error:', ctx.error)
      return { error: ctx.error }
    }

    // Make sure we don't double-convert.
    // Try full column set first; fall back if Phase 8 columns are missing.
    type ExistingQuote = { id: string; title: string; customer_id: string | null; converted_to_so_id: string | null; status: QuoteStatus; total: number | null }
    let existing: ExistingQuote | null = null

    const { data: eq1, error: eqErr1 } = await ctx.service
      .from('quotes')
      .select('id, title, customer_id, converted_to_so_id, status, total')
      .eq('id', quoteId)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (eq1) {
      existing = eq1 as unknown as ExistingQuote
    } else if (eqErr1?.message?.includes('does not exist')) {
      const { data: eq2 } = await ctx.service
        .from('quotes')
        .select('id, title, customer_id, status')
        .eq('id', quoteId)
        .eq('organization_id', orgId)
        .maybeSingle()
      if (eq2) {
        const q = eq2 as unknown as { id: string; title: string; customer_id: string | null; status: QuoteStatus }
        existing = { ...q, converted_to_so_id: null, total: null }
      }
    } else if (eqErr1) {
      return { error: `Quote lookup failed: ${eqErr1.message}` }
    }

    if (!existing) {
      console.error('[convertQuoteToSalesOrder] Quote not found')
      return { error: 'Quote not found.' }
    }
    console.log('[convertQuoteToSalesOrder] Found quote:', existing.id, existing.title)
    if (existing.converted_to_so_id) return { error: 'This quote already has a sales order.' }

    // Insert into sales_orders — do NOT use `as` cast so we see real errors.
    const soResult = await ctx.service
      .from('sales_orders')
      .insert({
        organization_id: orgId,
        quote_id: quoteId,
        customer_id: existing.customer_id,
        title: existing.title,
        total: existing.total ?? 0,
        status: 'new',
        created_by: ctx.user.id,
      })
      .select('id, so_number, created_at')
      .single()

    if (soResult.error) {
      console.error('[convertQuoteToSalesOrder] Insert error:', soResult.error.message)
      return { error: `Failed to create sales order: ${soResult.error.message}` }
    }
    const so = soResult.data as unknown as { id: string; so_number: number; created_at: string }
    if (!so?.id) {
      console.error('[convertQuoteToSalesOrder] Insert returned no data')
      return { error: 'Sales order insert returned no data. The sales_orders table may not exist — run migration 020_sales_orders_ensure.sql in the Supabase SQL Editor.' }
    }
    console.log('[convertQuoteToSalesOrder] Created SO:', so.id, 'so_number:', so.so_number)

    // Link quote to SO and set status. If converted_to_so_id column is
    // missing, fall back to updating status only.
    const linkResult = await ctx.service
      .from('quotes')
      .update({ converted_to_so_id: so.id, status: 'ordered' as QuoteStatus })
      .eq('id', quoteId)
      .eq('organization_id', orgId)

    if (linkResult.error?.message?.includes('does not exist')) {
      await ctx.service
        .from('quotes')
        .update({ status: 'ordered' as QuoteStatus })
        .eq('id', quoteId)
        .eq('organization_id', orgId)
    } else if (linkResult.error) {
      return { error: `Failed to link quote: ${linkResult.error.message}` }
    }

    revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
    revalidatePath(`/dashboard/${orgSlug}/quotes`)
    revalidatePath(`/dashboard/${orgSlug}/sales-orders`)
    return { soNumber: so.so_number, soId: so.id, createdAt: so.created_at }
  } catch (err) {
    console.error('[convertQuoteToSalesOrder] Unexpected error:', err)
    return { error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }
  }
}
