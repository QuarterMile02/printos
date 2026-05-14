'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'

// ── helpers ──────────────────────────────────────────────────────────────────

function t(v: string | null | undefined) { return v?.trim() || null }
function n(v: number | null | undefined) { return v ?? null }
function b(v: boolean | null | undefined) { return v ?? null }

// ── CREATE ───────────────────────────────────────────────────────────────────

export async function createCustomer(
  orgId: string,
  orgSlug: string,
  formData: FormData
): Promise<{ error?: string }> {
  const firstName = t(formData.get('first_name') as string | null)
  const lastName = t(formData.get('last_name') as string | null)
  if (!firstName) return { error: 'First name is required.' }
  if (!lastName) return { error: 'Last name is required.' }

  const { allowed } = await checkPermission(orgId, 'customers.create')
  if (!allowed) return { error: 'You do not have permission to create customers.' }

  const tagsRaw = t(formData.get('tags') as string | null)
  const tags = tagsRaw ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
  const salesRepId = t(formData.get('sales_rep_id') as string | null)
  const creditLimitRaw = (formData.get('credit_limit') as string | null)?.trim()

  const service = createServiceClient()
  const { error } = await service.from('customers').insert({
    organization_id: orgId,
    // contact
    first_name: firstName,
    last_name: lastName,
    company_name: t(formData.get('company_name') as string | null),
    email: t(formData.get('email') as string | null),
    phone: t(formData.get('phone') as string | null),
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
    payment_terms: t(formData.get('payment_terms') as string | null),
    credit_limit: creditLimitRaw ? parseFloat(creditLimitRaw) : null,
    taxable: formData.get('taxable') === 'true',
    tax_exempt_code: t(formData.get('tax_exempt_code') as string | null),
    tax_exempt_expires_at: t(formData.get('tax_exempt_expires_at') as string | null) || null,
    vat_number: t(formData.get('vat_number') as string | null),
    tax_rate: t(formData.get('tax_rate') as string | null),
    tags,
    ap_contact: t(formData.get('ap_contact') as string | null),
    other_info: t(formData.get('other_info') as string | null),
    background_info: t(formData.get('background_info') as string | null),
    special_notes: t(formData.get('special_notes') as string | null),
    notes: t(formData.get('notes') as string | null),
  })
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/customers`)
  return {}
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
    query = query.order('last_name', { ascending: false }).order('first_name', { ascending: false })
  } else if (sort === 'newest') {
    query = query.order('created_at', { ascending: false })
  } else {
    query = query.order('last_name', { ascending: true }).order('first_name', { ascending: true })
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
  const digits = term.replace(/\D/g, '')

  const conds = [
    `first_name.ilike.%${term}%`,
    `last_name.ilike.%${term}%`,
    `company_name.ilike.%${term}%`,
    `email.ilike.%${term}%`,
    `city.ilike.%${term}%`,
    `phone.ilike.%${term}%`,
  ]
  if (digits && digits !== term) conds.push(`phone.ilike.%${digits}%`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = service
    .from('customers')
    .select('id, first_name, last_name, company_name, email, phone, city, state, status, terms, is_active, tags, created_at')
    .eq('organization_id', orgId)
    .or(conds.join(','))

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

  query = query.order('last_name', { ascending: true }).order('first_name', { ascending: true }).limit(50)
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
    'first_name', 'last_name', 'company_name', 'email', 'phone', 'notes',
    'legal_name', 'sales_rep', 'industry', 'lead_source', 'customer_group',
    'status', 'street', 'street2', 'city', 'state', 'zip', 'country',
    'secondary_street', 'secondary_city', 'secondary_state', 'secondary_zip', 'secondary_country',
    'terms', 'tax_exempt_code', 'tax_exempt_expires', 'pricing_level',
    'website', 'background_info', 'special_notes',
  ] as const
  const boolFields = ['taxable', 'is_active', 'allow_credit_card_payments'] as const
  const numFields = ['credit_limit', 'discount_percent'] as const

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
