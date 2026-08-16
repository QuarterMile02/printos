'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logActivity } from '@/lib/logActivity'

// NOTE: recordPayment used to be duplicated here — this copy was dead code
// (zero importers; the invoice detail page's "Record Payment" form actually
// uses the one in ../actions.ts). Removed rather than left to drift further
// from the live implementation, which now has the marked_paid logActivity
// call (with order_thread_id) this copy already had.

// ============================================================
// Unpost / Edit / Repost flow (migration 132)
//
// Editing an invoice is only possible while is_posted = false. The DB
// trigger (guard_invoice_edit_when_posted, migration 132) enforces this
// as a backstop even against direct service-role writes; every action
// below also checks is_posted itself so callers get a clean error
// message instead of a raw Postgres exception.
//
// Role gate: owners/admins only. Posting/unposting reopens an accounting
// record — tighter than the "any non-viewer member" default the rest of
// invoices' RLS uses. Flagged as a default, not a hard requirement — easy
// to loosen to include 'member' (matching assignCustomerToSalesOrder's
// sales-manager-inclusive rule) if that's not the intent.
// ============================================================

const INVOICE_EDIT_COLS =
  'id, organization_id, is_posted, sales_order_id, customer_id, contact_id, ' +
  'title, notes, install_address, ' +
  'billing_company_name, billing_street, billing_street2, billing_city, billing_state, billing_zip, ' +
  'shipping_name, shipping_street, shipping_street2, shipping_city, shipping_state, shipping_zip'

type InvoiceEditRow = {
  id: string
  organization_id: string
  is_posted: boolean
  sales_order_id: string | null
  customer_id: string | null
  contact_id: string | null
  title: string | null
  notes: string | null
  install_address: string | null
  billing_company_name: string | null
  billing_street: string | null
  billing_street2: string | null
  billing_city: string | null
  billing_state: string | null
  billing_zip: string | null
  shipping_name: string | null
  shipping_street: string | null
  shipping_street2: string | null
  shipping_city: string | null
  shipping_state: string | null
  shipping_zip: string | null
}

async function assertInvoiceEditor(orgId: string): Promise<{ error?: string; userId?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: m } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!m || !['owner', 'admin'].includes(m.role))
    return { error: 'Only owners and admins can edit, unpost, or repost an invoice.' }
  return { userId: user.id }
}

async function resolveOrderThreadId(
  service: ReturnType<typeof createServiceClient>, salesOrderId: string | null,
): Promise<string | null> {
  if (!salesOrderId) return null
  const { data } = await service
    .from('sales_orders').select('quote_id').eq('id', salesOrderId).maybeSingle() as { data: { quote_id: string | null } | null; error: unknown }
  return data?.quote_id ?? salesOrderId
}

type FieldDiff = { field: string; from: string | null; to: string | null }

function diffFields(
  oldRow: Record<string, unknown>, newRow: Record<string, unknown>, fields: readonly string[],
): FieldDiff[] {
  const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v))
  const diffs: FieldDiff[] = []
  for (const f of fields) {
    const a = norm(oldRow[f])
    const b = norm(newRow[f])
    if (a !== b) diffs.push({ field: f, from: a, to: b })
  }
  return diffs
}

// Direct batched insert (not looped logActivity calls) so a multi-field
// edit is one round trip and shares a single change_group_id.
async function insertInvoiceFieldDiffs(
  service: ReturnType<typeof createServiceClient>,
  orgId: string, userId: string, invoiceId: string, orderThreadId: string | null, diffs: FieldDiff[],
): Promise<void> {
  if (!diffs.length) return
  const changeGroupId = crypto.randomUUID()
  const rows = diffs.map((d) => ({
    organization_id: orgId,
    user_id: userId,
    entity_type: 'invoice',
    entity_id: invoiceId,
    action: 'field_changed',
    field_name: d.field,
    from_value: d.from,
    to_value: d.to,
    change_group_id: changeGroupId,
    order_thread_id: orderThreadId,
  }))
  const { error } = await service.from('activity_log').insert(rows)
  if (error) console.error('[insertInvoiceFieldDiffs] failed:', error.message)
}

async function hasBeenEditedSinceUnpost(
  service: ReturnType<typeof createServiceClient>, invoiceId: string,
): Promise<boolean> {
  const { data: lastUnpost } = await service
    .from('activity_log').select('created_at')
    .eq('entity_type', 'invoice').eq('entity_id', invoiceId).eq('action', 'unposted')
    .order('created_at', { ascending: false }).limit(1).maybeSingle() as { data: { created_at: string } | null; error: unknown }
  if (!lastUnpost) return false // never unposted through this flow — fail closed, nothing to repost
  const { count } = await service
    .from('activity_log').select('id', { count: 'exact', head: true })
    .eq('entity_type', 'invoice').eq('entity_id', invoiceId).eq('action', 'field_changed')
    .gt('created_at', lastUnpost.created_at)
  return (count ?? 0) > 0
}

// Exported for the detail page (server component) to decide whether to
// render the Repost button — same check repostInvoice enforces itself.
export async function getInvoiceEditedSinceUnpost(invoiceId: string): Promise<boolean> {
  return hasBeenEditedSinceUnpost(createServiceClient(), invoiceId)
}

export async function unpostInvoice(invoiceId: string, orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const guard = await assertInvoiceEditor(orgId)
  if (guard.error) return { error: guard.error }
  const service = createServiceClient()

  const { data: invRow } = await service
    .from('invoices').select('id, is_posted, sales_order_id')
    .eq('id', invoiceId).eq('organization_id', orgId).maybeSingle() as
    { data: { id: string; is_posted: boolean; sales_order_id: string | null } | null; error: unknown }
  if (!invRow) return { error: 'Invoice not found.' }
  if (!invRow.is_posted) return { error: 'Invoice is already unposted.' }

  const { error } = await service.from('invoices')
    .update({ is_posted: false, posted_at: null, updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (error) return { error: error.message }

  const orderThreadId = await resolveOrderThreadId(service, invRow.sales_order_id)
  await logActivity({
    org_id: orgId, user_id: guard.userId!, entity_type: 'invoice', entity_id: invoiceId,
    action: 'unposted', from_value: 'posted', to_value: 'unposted',
    order_thread_id: orderThreadId ?? undefined,
  })

  revalidatePath(`/dashboard/${orgSlug}/invoices/${invoiceId}`)
  return {}
}

export async function repostInvoice(invoiceId: string, orgId: string, orgSlug: string): Promise<{ error?: string }> {
  const guard = await assertInvoiceEditor(orgId)
  if (guard.error) return { error: guard.error }
  const service = createServiceClient()

  const { data: invRow } = await service
    .from('invoices').select('id, is_posted, sales_order_id')
    .eq('id', invoiceId).eq('organization_id', orgId).maybeSingle() as
    { data: { id: string; is_posted: boolean; sales_order_id: string | null } | null; error: unknown }
  if (!invRow) return { error: 'Invoice not found.' }
  if (invRow.is_posted) return { error: 'Invoice is already posted.' }

  // No gating/waiting period per spec — but Repost only makes sense once
  // something has actually changed since the unpost. Re-checked here too,
  // not just hidden client-side, since this is reachable directly.
  if (!(await hasBeenEditedSinceUnpost(service, invoiceId))) {
    return { error: 'No changes have been made since this invoice was unposted — nothing to repost.' }
  }

  const { error } = await service.from('invoices')
    .update({ is_posted: true, posted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (error) return { error: error.message }

  const orderThreadId = await resolveOrderThreadId(service, invRow.sales_order_id)
  await logActivity({
    org_id: orgId, user_id: guard.userId!, entity_type: 'invoice', entity_id: invoiceId,
    action: 'reposted', from_value: 'unposted', to_value: 'posted',
    order_thread_id: orderThreadId ?? undefined,
  })

  revalidatePath(`/dashboard/${orgSlug}/invoices/${invoiceId}`)
  return {}
}

// customerId=null clears the customer entirely (and everything linked to
// it). "Everything customer-linked re-syncs" (confirmed spec) — a full
// customer swap re-derives BOTH billing and shipping from the new
// customer's saved addresses, not just billing; install_address is
// untouched (invoice-native, never customer-linked).
export async function assignCustomerToInvoice(
  invoiceId: string, orgId: string, orgSlug: string, customerId: string | null,
): Promise<{ error?: string }> {
  const guard = await assertInvoiceEditor(orgId)
  if (guard.error) return { error: guard.error }
  const service = createServiceClient()

  const { data: invRow } = await service
    .from('invoices').select(INVOICE_EDIT_COLS)
    .eq('id', invoiceId).eq('organization_id', orgId).maybeSingle() as { data: InvoiceEditRow | null; error: unknown }
  if (!invRow) return { error: 'Invoice not found.' }
  if (invRow.is_posted) return { error: 'Unpost the invoice before editing.' }

  let update: Record<string, unknown> = { customer_id: customerId, contact_id: null }

  if (customerId) {
    const { data: cust } = await service.from('customers')
      .select('company_name, street, street2, city, state, zip, secondary_street, secondary_city, secondary_state, secondary_zip')
      .eq('id', customerId).maybeSingle() as { data: {
        company_name: string | null; street: string | null; street2: string | null
        city: string | null; state: string | null; zip: string | null
        secondary_street: string | null; secondary_city: string | null; secondary_state: string | null; secondary_zip: string | null
      } | null; error: unknown }
    if (!cust) return { error: 'Selected customer not found.' }
    update = {
      ...update,
      billing_company_name: cust.company_name,
      billing_street: cust.street, billing_street2: cust.street2,
      billing_city: cust.city, billing_state: cust.state, billing_zip: cust.zip,
      shipping_name: cust.company_name,
      shipping_street: cust.secondary_street, shipping_street2: null,
      shipping_city: cust.secondary_city, shipping_state: cust.secondary_state, shipping_zip: cust.secondary_zip,
    }
  } else {
    update = {
      ...update,
      billing_company_name: null, billing_street: null, billing_street2: null, billing_city: null, billing_state: null, billing_zip: null,
      shipping_name: null, shipping_street: null, shipping_street2: null, shipping_city: null, shipping_state: null, shipping_zip: null,
    }
  }

  const { error } = await service.from('invoices').update({ ...update, updated_at: new Date().toISOString() }).eq('id', invoiceId)
  if (error) return { error: error.message }

  const diffs = diffFields(
    invRow as unknown as Record<string, unknown>,
    { ...invRow, ...update } as unknown as Record<string, unknown>,
    ['customer_id', 'contact_id', 'billing_company_name', 'billing_street', 'billing_street2', 'billing_city', 'billing_state', 'billing_zip',
      'shipping_name', 'shipping_street', 'shipping_street2', 'shipping_city', 'shipping_state', 'shipping_zip'],
  )
  const orderThreadId = await resolveOrderThreadId(service, invRow.sales_order_id)
  await insertInvoiceFieldDiffs(service, orgId, guard.userId!, invoiceId, orderThreadId, diffs)

  revalidatePath(`/dashboard/${orgSlug}/invoices/${invoiceId}`)
  return {}
}

// Independent of assignCustomerToInvoice — picking a different contact
// for the same customer, no cascade beyond the one field.
export async function assignContactToInvoice(
  invoiceId: string, orgId: string, orgSlug: string, contactId: string | null,
): Promise<{ error?: string }> {
  const guard = await assertInvoiceEditor(orgId)
  if (guard.error) return { error: guard.error }
  const service = createServiceClient()

  const { data: invRow } = await service
    .from('invoices').select('id, is_posted, sales_order_id, contact_id')
    .eq('id', invoiceId).eq('organization_id', orgId).maybeSingle() as
    { data: { id: string; is_posted: boolean; sales_order_id: string | null; contact_id: string | null } | null; error: unknown }
  if (!invRow) return { error: 'Invoice not found.' }
  if (invRow.is_posted) return { error: 'Unpost the invoice before editing.' }

  const { error } = await service.from('invoices')
    .update({ contact_id: contactId, updated_at: new Date().toISOString() })
    .eq('id', invoiceId)
  if (error) return { error: error.message }

  const orderThreadId = await resolveOrderThreadId(service, invRow.sales_order_id)
  await insertInvoiceFieldDiffs(service, orgId, guard.userId!, invoiceId, orderThreadId,
    [{ field: 'contact_id', from: invRow.contact_id, to: contactId }])

  revalidatePath(`/dashboard/${orgSlug}/invoices/${invoiceId}`)
  return {}
}

// Free-text editable fields — title/notes/install_address plus the
// billing/shipping lines that aren't cascade-only. billing_company_name
// is deliberately NOT here: per spec it only ever changes via the
// customer cascade above, never as an independent free-text override.
const EDITABLE_TEXT_FIELDS = [
  'title', 'notes', 'install_address',
  'billing_street', 'billing_street2', 'billing_city', 'billing_state', 'billing_zip',
  'shipping_name', 'shipping_street', 'shipping_street2', 'shipping_city', 'shipping_state', 'shipping_zip',
] as const

export async function updateInvoiceDetails(formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const invoiceId = formData.get('invoiceId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  if (!invoiceId || !orgId || !orgSlug) return { error: 'Missing required fields.' }

  const guard = await assertInvoiceEditor(orgId)
  if (guard.error) return { error: guard.error }
  const service = createServiceClient()

  const { data: invRow } = await service
    .from('invoices').select(INVOICE_EDIT_COLS)
    .eq('id', invoiceId).eq('organization_id', orgId).maybeSingle() as { data: InvoiceEditRow | null; error: unknown }
  if (!invRow) return { error: 'Invoice not found.' }
  if (invRow.is_posted) return { error: 'Unpost the invoice before editing.' }

  const str = (name: string): string | null => {
    const v = formData.get(name)
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  }

  const update: Record<string, string | null> = {}
  for (const f of EDITABLE_TEXT_FIELDS) update[f] = str(f)

  const { error } = await service.from('invoices').update({ ...update, updated_at: new Date().toISOString() }).eq('id', invoiceId)
  if (error) return { error: error.message }

  const diffs = diffFields(invRow as unknown as Record<string, unknown>, update, EDITABLE_TEXT_FIELDS)
  const orderThreadId = await resolveOrderThreadId(service, invRow.sales_order_id)
  await insertInvoiceFieldDiffs(service, orgId, guard.userId!, invoiceId, orderThreadId, diffs)

  revalidatePath(`/dashboard/${orgSlug}/invoices/${invoiceId}`)
  return { ok: true }
}
