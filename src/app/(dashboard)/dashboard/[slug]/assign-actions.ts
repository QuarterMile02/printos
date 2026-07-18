'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function quickCreateCustomer(
  orgId: string,
  orgSlug: string,
  firstName: string,
  lastName: string,
  companyName: string | null,
): Promise<{ error?: string; id?: string; name?: string; company?: string | null }> {
  const guard = await assertOwnerOrAdmin(orgId)
  if (guard.error) return guard

  const fn = firstName.trim()
  const ln = lastName.trim()
  if (!fn) return { error: 'First name is required.' }
  if (!ln) return { error: 'Last name is required.' }

  const service = createServiceClient()
  const { data, error } = await service
    .from('customers')
    .insert({
      organization_id: orgId,
      first_name: fn,
      last_name: ln,
      company_name: companyName?.trim() || null,
      is_active: true,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/customers`)
  return { id: data.id, name: `${fn} ${ln}`, company: companyName?.trim() || null }
}

async function assertOwnerOrAdmin(orgId: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: m } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!m || !['owner', 'admin'].includes(m.role))
    return { error: 'Only owners and admins can reassign customers and contacts.' }
  return {}
}

// ── Quote ──────────────────────────────────────────────────────────────────────

export async function assignCustomerToQuote(
  quoteId: string, orgId: string, orgSlug: string, customerId: string | null,
): Promise<{ error?: string }> {
  const guard = await assertOwnerOrAdmin(orgId)
  if (guard.error) return guard
  const service = createServiceClient()
  const { error } = await service.from('quotes')
    .update({ customer_id: customerId, contact_id: null })
    .eq('id', quoteId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  return {}
}

export async function assignContactToQuote(
  quoteId: string, orgId: string, orgSlug: string, contactId: string | null,
): Promise<{ error?: string }> {
  const guard = await assertOwnerOrAdmin(orgId)
  if (guard.error) return guard
  const service = createServiceClient()
  const { error } = await service.from('quotes')
    .update({ contact_id: contactId })
    .eq('id', quoteId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/quotes/${quoteId}`)
  return {}
}

// ── Sales Order ────────────────────────────────────────────────────────────────

export async function assignCustomerToSalesOrder(
  soId: string, orgId: string, orgSlug: string, customerId: string | null,
): Promise<{ error?: string }> {
  // Allowed roles: owner, admin, member (sales manager)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: m } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!m || !['owner', 'admin', 'member'].includes(m.role))
    return { error: 'Only owners, admins, and sales managers can reassign a sales order\'s customer.' }
  const service = createServiceClient()
  const { error } = await service.from('sales_orders')
    .update({ customer_id: customerId, contact_id: null })
    .eq('id', soId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  // Also sync the customer to the linked quote if one exists
  try {
    const { data: soRow } = await service.from('sales_orders').select('quote_id').eq('id', soId).maybeSingle() as { data: { quote_id?: string | null } | null; error: unknown }
    if (soRow?.quote_id) {
      await service.from('quotes').update({ customer_id: customerId }).eq('id', soRow.quote_id)
    }
  } catch { /* quote sync optional */ }
  revalidatePath(`/dashboard/${orgSlug}/sales-orders/${soId}`)
  return {}
}

export async function assignContactToSalesOrder(
  soId: string, orgId: string, orgSlug: string, contactId: string | null,
): Promise<{ error?: string }> {
  // Allowed roles: owner, admin, member (sales manager)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: m } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!m || !['owner', 'admin', 'member'].includes(m.role))
    return { error: 'Only owners, admins, and sales managers can reassign a sales order\'s contact.' }
  const service = createServiceClient()
  const { error } = await service.from('sales_orders')
    .update({ contact_id: contactId })
    .eq('id', soId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/sales-orders/${soId}`)
  return {}
}

// ── Job ───────────────────────────────────────────────────────────────────────

export async function assignCustomerToJob(
  jobId: string, orgId: string, orgSlug: string, customerId: string | null,
): Promise<{ error?: string }> {
  // Allowed roles: owner, admin, member (sales manager)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }
  const { data: m } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', orgId).eq('user_id', user.id).maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!m || !['owner', 'admin', 'member'].includes(m.role))
    return { error: 'Only owners, admins, and sales managers can reassign a job\'s customer.' }
  const service = createServiceClient()
  const { error } = await service.from('jobs')
    .update({ customer_id: customerId, contact_id: null })
    .eq('id', jobId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/jobs/${jobId}`)
  return {}
}

export async function assignContactToJob(
  jobId: string, orgId: string, orgSlug: string, contactId: string | null,
): Promise<{ error?: string }> {
  const guard = await assertOwnerOrAdmin(orgId)
  if (guard.error) return guard
  const service = createServiceClient()
  const { error } = await service.from('jobs')
    .update({ contact_id: contactId })
    .eq('id', jobId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/jobs/${jobId}`)
  return {}
}

// ── Shared lookup ─────────────────────────────────────────────────────────────

export type ContactOption = {
  id: string
  full_name: string
  title: string | null
  phone: string | null
  is_primary: boolean | null
}

export async function fetchContactsForCustomer(
  customerId: string, orgId: string,
): Promise<ContactOption[]> {
  const service = createServiceClient()
  const { data } = await service
    .from('customer_contacts')
    .select('id, full_name, title, phone, is_primary')
    .eq('customer_id', customerId)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .order('is_primary', { ascending: false })
    .order('full_name')
  return (data ?? []) as ContactOption[]
}
