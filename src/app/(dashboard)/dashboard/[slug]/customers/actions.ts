'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { revalidatePath } from 'next/cache'
import { randomBytes } from 'crypto'
import { SYSTEM_FROM_EMAIL } from '@/lib/email-sender'
import type { OrgRole } from '@/types/database'

// ── helpers ──────────────────────────────────────────────────────────────────

function t(v: string | null | undefined) { return v?.trim() || null }
function n(v: number | null | undefined) { return v ?? null }
function b(v: boolean | null | undefined) { return v ?? null }

// QMI's own domains -- a contact with one of these is staff, not a real
// portal candidate (see migration 135's staff-email-exclusion backfill).
// Used by both saveContact() (recomputed live on every create/edit, so a
// changed email can never leave a stale flag behind) and sendPortalInvite()
// (a second, independent check at invite time -- belt-and-suspenders, not
// redundant: it protects rows that predate this recompute-on-save logic
// too, e.g. any restored from a backup or written by a path that bypasses
// saveContact entirely).
const STAFF_EMAIL_DOMAINS = ['@quartermileinc.com', '@qtrmilegraphics.com']
function isStaffEmail(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase()
  return !!e && STAFF_EMAIL_DOMAINS.some((d) => e.endsWith(d))
}

// ── CREATE ───────────────────────────────────────────────────────────────────

export async function createCustomer(
  orgId: string,
  orgSlug: string,
  formData: FormData
): Promise<{ error?: string; id?: string }> {
  const firstName = t(formData.get('first_name') as string | null)
  const lastName = t(formData.get('last_name') as string | null)
  console.log('[createCustomer] firstName:', firstName, 'lastName:', lastName, 'orgId:', orgId)
  if (!firstName) return { error: 'First name is required.' }
  if (!lastName) return { error: 'Last name is required.' }

  const { allowed } = await checkPermission(orgId, 'customers.create')
  if (!allowed) return { error: 'You do not have permission to create customers.' }

  const tagsRaw = t(formData.get('tags') as string | null)
  const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
  const salesRepId = t(formData.get('sales_rep_id') as string | null)
  const creditLimitRaw = (formData.get('credit_limit') as string | null)?.trim()

  const service = createServiceClient()
  const companyName = t(formData.get('company_name') as string | null)
  const email = t(formData.get('email') as string | null)
  const phone = t(formData.get('phone') as string | null)
  const phone2 = t(formData.get('phone2') as string | null)

  const { data: inserted, error } = await service.from('customers').insert({
    organization_id: orgId,
    // contact
    first_name: firstName,
    last_name: lastName,
    company_name: companyName,
    email,
    phone,
    phone2,
    phone_ext: t(formData.get('phone_ext') as string | null),
    website: t(formData.get('website') as string | null),
    // primary address
    street: t(formData.get('street') as string | null),
    street2: t(formData.get('street2') as string | null),
    suburb: t(formData.get('suburb') as string | null),
    city: t(formData.get('city') as string | null),
    state: t(formData.get('state') as string | null),
    zip: t(formData.get('zip') as string | null),
    country: t(formData.get('country') as string | null) || 'US',
    address_type: t(formData.get('address_type') as string | null),
    attention_to: t(formData.get('attention_to') as string | null),
    label: t(formData.get('label') as string | null),
    // secondary address
    secondary_street: t(formData.get('secondary_street') as string | null),
    secondary_street2: t(formData.get('secondary_street2') as string | null),
    secondary_suburb: t(formData.get('secondary_suburb') as string | null),
    secondary_city: t(formData.get('secondary_city') as string | null),
    secondary_state: t(formData.get('secondary_state') as string | null),
    secondary_zip: t(formData.get('secondary_zip') as string | null),
    secondary_country: t(formData.get('secondary_country') as string | null),
    secondary_address_type: t(formData.get('secondary_address_type') as string | null),
    secondary_attention_to: t(formData.get('secondary_attention_to') as string | null),
    // account
    status: t(formData.get('status') as string | null) || 'lead',
    sales_rep_id: salesRepId || null,
    industry: t(formData.get('industry') as string | null),
    lead_source: t(formData.get('lead_source') as string | null),
    pricing_level: t(formData.get('pricing_level') as string | null),
    terms: t(formData.get('payment_terms') as string | null),
    credit_limit: creditLimitRaw ? parseFloat(creditLimitRaw) : null,
    taxable: formData.get('taxable') === 'true',
    tax_exempt_code: t(formData.get('tax_exempt_code') as string | null),
    tax_exempt_expires: t(formData.get('tax_exempt_expires_at') as string | null) || null,
    vat_number: t(formData.get('vat_number') as string | null),
    tax_rate: t(formData.get('tax_rate') as string | null),
    tags,
    ap_contact: t(formData.get('ap_contact') as string | null),
    other_info: t(formData.get('other_info') as string | null),
    background_info: t(formData.get('background_info') as string | null),
    special_notes: t(formData.get('special_notes') as string | null),
    notes: t(formData.get('notes') as string | null),
    sms_consent: formData.get('sms_consent') === 'true',
  }).select('id').single()
  if (error) return { error: error.message }

  // Auto-create primary contact from the form's primary contact fields
  if (inserted?.id) {
    try {
      await service.from('customer_contacts').insert({
        customer_id: inserted.id,
        organization_id: orgId,
        full_name: `${firstName} ${lastName}`.trim(),
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        is_primary: true,
        is_ap_contact: false,
        is_customer_self: true,
      })
    } catch {
      // best-effort — don't fail the whole create if contact insert fails
    }
  }

  revalidatePath(`/dashboard/${orgSlug}/customers`)
  return { id: inserted?.id }
}

// ── LOAD MORE (for paginated list) ───────────────────────────────────────────

export type CustomerListRow = {
  id: string
  first_name: string
  last_name: string
  company_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: string | null
  terms: string | null
  is_active: boolean | null
  tags: string[]
  created_at: string
}

export async function loadMoreCustomers(
  orgId: string,
  filters: { sort?: string; status?: string; type?: string; tag?: string },
  offset: number,
): Promise<CustomerListRow[]> {
  const service = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = service
    .from('customers')
    .select('id, first_name, last_name, company_name, email, phone, city, state, status, terms, is_active, tags, created_at')
    .eq('organization_id', orgId)

  if (filters.status === 'inactive') {
    query = query.eq('is_active', false)
  } else if (filters.status) {
    query = query.eq('status', filters.status)
  }

  if (filters.type === 'company') {
    query = query.not('company_name', 'is', null).neq('company_name', '')
  } else if (filters.type === 'individual') {
    query = query.or('company_name.is.null,company_name.eq.')
  }

  if (filters.tag) {
    query = query.contains('tags', [filters.tag])
  }

  const sort = filters.sort ?? 'name_asc'
  if (sort === 'name_desc') {
    query = query
      .order('company_name', { ascending: false, nullsFirst: true })
      .order('last_name', { ascending: false })
      .order('first_name', { ascending: false })
  } else if (sort === 'newest') {
    query = query.order('created_at', { ascending: false })
  } else {
    // Default A→Z: company name first (nulls last), then last/first name
    query = query
      .order('company_name', { ascending: true, nullsFirst: false })
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true })
  }

  query = query.range(offset, offset + 49)
  const { data } = await query
  return (data ?? []) as CustomerListRow[]
}

export async function searchCustomers(
  orgId: string,
  term: string,
  filters: { status?: string; type?: string; tag?: string },
): Promise<CustomerListRow[]> {
  const service = createServiceClient()

  // Try trigram fuzzy search (requires pg_trgm extension + 062 migration)
  try {
    const { data: fuzzyData, error } = await service.rpc('search_customers_fuzzy', {
      p_org_id: orgId,
      p_term: term,
    }) as { data: CustomerListRow[] | null; error: unknown }

    if (!error && fuzzyData) {
      let rows = fuzzyData
      if (filters.status === 'inactive') rows = rows.filter((r) => r.is_active === false)
      else if (filters.status) rows = rows.filter((r) => r.status === filters.status)
      if (filters.type === 'company') rows = rows.filter((r) => r.company_name)
      else if (filters.type === 'individual') rows = rows.filter((r) => !r.company_name)
      if (filters.tag) rows = rows.filter((r) => r.tags?.includes(filters.tag!))
      return rows
    }
  } catch {
    // pg_trgm not installed — fall through to ILIKE search
  }

  // Fallback: ILIKE search (works without pg_trgm)
  const digits = term.replace(/\D/g, '')

  const { data: contactHits } = await service
    .from('customer_contacts')
    .select('customer_id')
    .eq('organization_id', orgId)
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,full_name.ilike.%${term}%`)
  const contactIds = [...new Set((contactHits ?? []).map((c) => c.customer_id).filter(Boolean))]

  const conds = [
    `first_name.ilike.%${term}%`,
    `last_name.ilike.%${term}%`,
    `company_name.ilike.%${term}%`,
    `email.ilike.%${term}%`,
    `city.ilike.%${term}%`,
    `phone.ilike.%${term}%`,
  ]
  if (digits && digits !== term) conds.push(`phone.ilike.%${digits}%`)
  if (contactIds.length > 0) conds.push(`id.in.(${contactIds.join(',')})`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = service
    .from('customers')
    .select('id, first_name, last_name, company_name, email, phone, city, state, status, terms, is_active, tags, created_at')
    .eq('organization_id', orgId)
    .or(conds.join(','))

  if (filters.status === 'inactive') query = query.eq('is_active', false)
  else if (filters.status) query = query.eq('status', filters.status)
  if (filters.type === 'company') query = query.not('company_name', 'is', null).neq('company_name', '')
  else if (filters.type === 'individual') query = query.or('company_name.is.null,company_name.eq.')
  if (filters.tag) query = query.contains('tags', [filters.tag])

  query = query
    .order('company_name', { ascending: true, nullsFirst: false })
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .limit(50)
  const { data } = await query
  return (data ?? []) as CustomerListRow[]
}

// ── UPDATE — covers all editable customer fields ──────────────────────────────

export type CustomerUpdatePayload = {
  // core
  first_name?: string
  last_name?: string
  company_name?: string | null
  email?: string | null
  phone?: string | null
  phone2?: string | null
  phone_ext?: string | null
  notes?: string | null
  legal_name?: string | null
  sales_rep?: string | null
  industry?: string | null
  lead_source?: string | null
  customer_group?: string | null
  status?: string | null
  is_active?: boolean | null
  // address
  street?: string | null
  street2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  secondary_street?: string | null
  secondary_city?: string | null
  secondary_state?: string | null
  secondary_zip?: string | null
  country?: string | null
  secondary_country?: string | null
  // account / finance
  terms?: string | null
  taxable?: boolean | null
  tax_exempt_code?: string | null
  tax_exempt_expires?: string | null
  credit_limit?: number | null
  pricing_level?: string | null
  discount_percent?: number | null
  website?: string | null
  allow_credit_card_payments?: boolean | null
  background_info?: string | null
  special_notes?: string | null
  sms_consent?: boolean | null
  // Portal
  portal_enabled?: boolean | null
  portal_tier_id?: string | null
  // Shipping
  shipping_method?: string | null
}

export async function updateCustomer(
  customerId: string,
  orgId: string,
  orgSlug: string,
  data: CustomerUpdatePayload
): Promise<{ error?: string }> {
  if ('first_name' in data && !data.first_name?.trim()) return { error: 'First name is required.' }
  if ('last_name' in data && !data.last_name?.trim()) return { error: 'Last name is required.' }

  const { allowed } = await checkPermission(orgId, 'customers.edit')
  if (!allowed) return { error: 'You do not have permission to edit customers.' }

  // Build a clean payload (trim strings, preserve booleans/numbers)
  const payload: Record<string, unknown> = {}
  const textFields = [
    'first_name', 'last_name', 'company_name', 'email', 'phone', 'phone2', 'phone_ext', 'notes',
    'legal_name', 'sales_rep', 'industry', 'lead_source', 'customer_group',
    'status', 'street', 'street2', 'city', 'state', 'zip', 'country',
    'secondary_street', 'secondary_city', 'secondary_state', 'secondary_zip', 'secondary_country',
    'terms', 'tax_exempt_code', 'tax_exempt_expires', 'pricing_level',
    'website', 'background_info', 'special_notes', 'shipping_method',
  ] as const
  const boolFields = ['taxable', 'is_active', 'allow_credit_card_payments', 'sms_consent', 'portal_enabled'] as const
  const numFields = ['credit_limit', 'discount_percent'] as const
  if ('portal_tier_id' in data) payload['portal_tier_id'] = data.portal_tier_id ?? null

  for (const f of textFields) {
    if (f in data) payload[f] = t(data[f] as string | null)
  }
  for (const f of boolFields) {
    if (f in data) payload[f] = b(data[f])
  }
  for (const f of numFields) {
    if (f in data) payload[f] = n(data[f])
  }

  const service = createServiceClient()
  const { error } = await service
    .from('customers')
    .update(payload)
    .eq('id', customerId)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/customers`)
  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  return {}
}

// ── CONTACTS ─────────────────────────────────────────────────────────────────

export type ContactInput = {
  full_name: string
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  email2?: string | null
  phone?: string | null
  phone2?: string | null
  phone_ext?: string | null
  title?: string | null
  is_primary?: boolean
  is_ap_contact?: boolean
}

export async function saveContact(
  customerId: string,
  orgId: string,
  orgSlug: string,
  contact: ContactInput,
  contactId?: string
): Promise<{ error?: string; id?: string }> {
  if (!contact.full_name?.trim()) return { error: 'Full name is required.' }

  const { allowed } = await checkPermission(orgId, 'customers.edit')
  if (!allowed) return { error: 'You do not have permission to edit contacts.' }

  const service = createServiceClient()
  const email = t(contact.email)

  if (!contactId) {
    // Dedup guard: reject if this email already belongs to another contact of this customer
    if (email) {
      const { data: existing } = await service
        .from('customer_contacts')
        .select('id')
        .eq('customer_id', customerId)
        .ilike('email', email)
        .maybeSingle()
      if (existing) return { error: 'A contact with that email already exists for this customer.' }
    }

    const { data, error } = await service
      .from('customer_contacts')
      .insert({
        customer_id: customerId,
        organization_id: orgId,
        full_name: contact.full_name.trim(),
        first_name: t(contact.first_name),
        last_name: t(contact.last_name),
        email,
        email2: t(contact.email2),
        phone: t(contact.phone),
        phone2: t(contact.phone2),
        phone_ext: t(contact.phone_ext),
        title: t(contact.title),
        is_primary: contact.is_primary ?? false,
        is_ap_contact: contact.is_ap_contact ?? false,
        is_staff_contact: isStaffEmail(email),
      })
      .select('id')
      .single()
    if (error) return { error: error.message }
    revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
    return { id: data.id }
  }

  // Update — check if the new email conflicts with a DIFFERENT contact
  if (email) {
    const { data: conflict } = await service
      .from('customer_contacts')
      .select('id')
      .eq('customer_id', customerId)
      .ilike('email', email)
      .neq('id', contactId)
      .maybeSingle()
    if (conflict) return { error: 'Another contact already uses that email.' }
  }

  const { error } = await service
    .from('customer_contacts')
    .update({
      full_name: contact.full_name.trim(),
      first_name: t(contact.first_name),
      last_name: t(contact.last_name),
      email,
      email2: t(contact.email2),
      phone: t(contact.phone),
      phone2: t(contact.phone2),
      phone_ext: t(contact.phone_ext),
      title: t(contact.title),
      is_primary: contact.is_primary ?? false,
      is_ap_contact: contact.is_ap_contact ?? false,
      // Recomputed from the CURRENT email on every save, not just carried
      // over -- this is the fix for the 2026-08-17 stale-flag bug: a
      // contact whose email changed away from a QMI domain used to keep
      // is_staff_contact=true forever, since nothing ever recomputed it.
      is_staff_contact: isStaffEmail(email),
    })
    .eq('id', contactId)
    .eq('customer_id', customerId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  return { id: contactId }
}

export async function setPrimaryContact(
  contactId: string,
  customerId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const { allowed } = await checkPermission(orgId, 'customers.edit')
  if (!allowed) return { error: 'You do not have permission to edit contacts.' }

  const service = createServiceClient()

  // Clear all primaries for this customer, then set the target — two atomic steps.
  const { error: clearErr } = await service
    .from('customer_contacts')
    .update({ is_primary: false })
    .eq('customer_id', customerId)
    .eq('organization_id', orgId)
  if (clearErr) return { error: clearErr.message }

  const { error: setErr } = await service
    .from('customer_contacts')
    .update({ is_primary: true })
    .eq('id', contactId)
    .eq('customer_id', customerId)
  if (setErr) return { error: setErr.message }

  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  return {}
}

export async function deleteCustomer(
  customerId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return { error: 'Only owners and admins can delete customers.' }
  }

  const service = createServiceClient()

  // Delete requires BOTH: already deactivated, AND zero linked records.
  const { data: customerRow } = await service
    .from('customers').select('is_active').eq('id', customerId).eq('organization_id', orgId).maybeSingle()
  if (customerRow?.is_active !== false) {
    return { error: 'Cannot delete — customer must be deactivated first.' }
  }

  // Dependency check — run in parallel
  const [{ count: quoteCount }, { count: jobCount }, { count: soCount }, { count: invCount }] =
    await Promise.all([
      service.from('quotes').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
      service.from('jobs').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
      service.from('sales_orders').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
      service.from('invoices').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    ])

  const linked: string[] = []
  if ((quoteCount ?? 0) > 0) linked.push(`${quoteCount} quote${quoteCount === 1 ? '' : 's'}`)
  if ((jobCount ?? 0) > 0) linked.push(`${jobCount} job${jobCount === 1 ? '' : 's'}`)
  if ((soCount ?? 0) > 0) linked.push(`${soCount} sales order${soCount === 1 ? '' : 's'}`)
  if ((invCount ?? 0) > 0) linked.push(`${invCount} invoice${invCount === 1 ? '' : 's'}`)

  if (linked.length > 0) {
    return { error: `Cannot delete — customer is linked to ${linked.join(', ')}. Modify those first.` }
  }

  const { error } = await service.from('customers').delete().eq('id', customerId).eq('organization_id', orgId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/customers`)
  return {}
}

export async function deactivateCustomer(
  customerId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership || !['owner', 'admin', 'member'].includes(membership.role)) {
    return { error: 'You do not have permission to deactivate customers.' }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('customers').update({ is_active: false }).eq('id', customerId).eq('organization_id', orgId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  revalidatePath(`/dashboard/${orgSlug}/customers`)
  return {}
}

export async function reactivateCustomer(
  customerId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const { allowed } = await checkPermission(orgId, 'customers.edit')
  if (!allowed) return { error: 'You do not have permission to edit customers.' }
  const service = createServiceClient()
  const { error } = await service
    .from('customers').update({ is_active: true }).eq('id', customerId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  revalidatePath(`/dashboard/${orgSlug}/customers`)
  return {}
}

export async function deleteContact(
  contactId: string,
  customerId: string,
  orgId: string,
  orgSlug: string
): Promise<{ error?: string }> {
  // Only owners/admins can delete — check customers.delete permission
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }

  if (!membership || !['owner', 'admin', 'member'].includes(membership.role)) {
    return { error: 'You do not have permission to delete contacts.' }
  }

  const service = createServiceClient()
  const { error } = await service
    .from('customer_contacts')
    .delete()
    .eq('id', contactId)
    .eq('customer_id', customerId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  return {}
}

// ── SALES LEAD ────────────────────────────────────────────────────────────────
export async function createSalesLeadForCustomer(
  customerId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const { allowed } = await checkPermission(orgId, 'customers.edit')
  if (!allowed) return { error: 'You do not have permission to update customers.' }
  const service = createServiceClient()
  const { error } = await service
    .from('customers')
    .update({ status: 'lead' })
    .eq('id', customerId)
    .eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  return {}
}

export async function getCustomerById(orgId: string, customerId: string): Promise<{ id: string; first_name: string; last_name: string; company_name: string | null } | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('customers')
    .select('id, first_name, last_name, company_name')
    .eq('organization_id', orgId)
    .eq('id', customerId)
    .maybeSingle()
  return data as { id: string; first_name: string; last_name: string; company_name: string | null } | null
}

// ── PORTAL INVITE ────────────────────────────────────────────────────────────
//
// Customer Portal account/invite build plan (rev. 2), step 3.
//
// Two staff-exclusion checks are deliberately both present, not redundant:
// is_staff_contact (kept live by saveContact() on every create/edit, plus
// migration 135's original backfill) AND the isStaffEmail() live domain
// check right here. The stored flag going stale was exactly the bug found
// 2026-08-17 (a contact's email changed after backfill, saveContact() at
// the time never recomputed the flag, so a real customer contact stayed
// hidden from the invite UI) -- fixed at the source in saveContact() now,
// but this second, independent check stays as defense-in-depth for any row
// that bypasses saveContact entirely (direct DB writes, future import
// tooling, etc.), same reasoning as the SMS/payment-gateway credential
// checks elsewhere in this codebase never trusting a single layer alone.
//
// Explicit opt-in only (locked decision, rev. 2 plan): if this email already
// has a portal_user_id on a DIFFERENT customer_contacts row (same person,
// already invited elsewhere), this links the existing account to this row --
// no new password, no new auth.users row, no auto-discovery of other
// relationships beyond what's being explicitly invited right now.

function baseAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://printos-lemon.vercel.app')
}

async function sendPortalInviteEmail(toEmail: string, contactName: string, customerLabel: string, orgName: string, link: string): Promise<string | null> {
  if (!process.env.RESEND_API_KEY) return 'Email delivery not configured — RESEND_API_KEY is missing.'
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <p>Hi ${contactName.split(' ')[0] || contactName},</p>
      <p>${orgName} has invited you to the Customer Portal for <strong>${customerLabel}</strong>, where you'll be able to view your quotes, orders, invoices, and payments.</p>
      <p><a href="${link}" style="display:inline-block;background:#111827;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;">Set up your account</a></p>
      <p style="color:#6b7280;font-size:13px;">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
    </div>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: SYSTEM_FROM_EMAIL, to: [toEmail], subject: `You're invited to the ${orgName} Customer Portal`, html }),
  })
  if (!res.ok) return `Email failed: ${await res.text()}`
  return null
}

async function sendPortalLinkedNoticeEmail(toEmail: string, contactName: string, customerLabel: string, orgName: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return // best-effort notice only -- don't fail the whole action over it
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <p>Hi ${contactName.split(' ')[0] || contactName},</p>
      <p>Your existing ${orgName} Customer Portal account now also has access to <strong>${customerLabel}</strong>. Sign in as usual to view it.</p>
    </div>`
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: SYSTEM_FROM_EMAIL, to: [toEmail], subject: `${orgName} Customer Portal — new access added`, html }),
  }).catch(() => {})
}

export async function sendPortalInvite(
  contactId: string,
  customerId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string; linkedExisting?: boolean }> {
  const { allowed } = await checkPermission(orgId, 'customers.edit')
  if (!allowed) return { error: 'You do not have permission to invite contacts.' }

  const service = createServiceClient()

  const { data: contact, error: contactErr } = await service
    .from('customer_contacts')
    .select('id, email, full_name, is_staff_contact, portal_user_id')
    .eq('id', contactId)
    .eq('customer_id', customerId)
    .eq('organization_id', orgId)
    .maybeSingle() as { data: { id: string; email: string | null; full_name: string; is_staff_contact: boolean; portal_user_id: string | null } | null; error: unknown }
  if (contactErr) return { error: (contactErr as { message: string }).message }
  if (!contact) return { error: 'Contact not found.' }
  if (!contact.email) return { error: 'This contact has no email address on file.' }
  if (contact.portal_user_id) return { error: 'This contact already has portal access.' }

  const email = contact.email.trim().toLowerCase()
  if (contact.is_staff_contact || isStaffEmail(email)) {
    return { error: 'This contact is a QMI staff address and cannot be given portal access.' }
  }

  const [customerRes, orgRes] = await Promise.all([
    service.from('customers').select('company_name, first_name, last_name').eq('id', customerId).eq('organization_id', orgId).maybeSingle(),
    service.from('organizations').select('name').eq('id', orgId).maybeSingle(),
  ])
  const customer = customerRes.data as { company_name: string | null; first_name: string; last_name: string } | null
  const org = orgRes.data as { name: string | null } | null
  const customerLabel = customer?.company_name?.trim() || `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim() || 'your account'
  const orgName = org?.name?.trim() || 'PrintOS'

  // Explicit opt-in reuse check: does this email already have a portal
  // account (on a DIFFERENT customer_contacts row, same org)? If so, link
  // directly -- no token, no password prompt, per the locked decision.
  const { data: existingAccount } = await service
    .from('customer_contacts')
    .select('portal_user_id')
    .eq('organization_id', orgId)
    .ilike('email', email)
    .not('portal_user_id', 'is', null)
    .neq('id', contactId)
    .limit(1)
    .maybeSingle() as { data: { portal_user_id: string } | null }

  if (existingAccount?.portal_user_id) {
    const { error: linkErr } = await service
      .from('customer_contacts')
      .update({ portal_user_id: existingAccount.portal_user_id, portal_invited_at: new Date().toISOString() })
      .eq('id', contactId)
    if (linkErr) return { error: linkErr.message }

    await sendPortalLinkedNoticeEmail(email, contact.full_name, customerLabel, orgName)
    revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
    return { linkedExisting: true }
  }

  // Fresh invite: generate token, mirrors organization_invites' shape (migration 001).
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { error: tokenErr } = await service
    .from('customer_contacts')
    .update({ portal_invite_token: token, portal_invite_expires_at: expiresAt, portal_invited_at: new Date().toISOString() })
    .eq('id', contactId)
  if (tokenErr) return { error: tokenErr.message }

  const link = `${baseAppUrl()}/portal/accept-invite?token=${token}`
  const emailErr = await sendPortalInviteEmail(email, contact.full_name, customerLabel, orgName, link)
  if (emailErr) return { error: emailErr }

  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
  return {}
}
