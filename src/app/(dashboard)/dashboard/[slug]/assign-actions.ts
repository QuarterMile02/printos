'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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
  const guard = await assertOwnerOrAdmin(orgId)
  if (guard.error) return guard
  const service = createServiceClient()
  const { error } = await service.from('sales_orders')
    .update({ customer_id: customerId, contact_id: null })
    .eq('id', soId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/sales-orders/${soId}`)
  return {}
}

export async function assignContactToSalesOrder(
  soId: string, orgId: string, orgSlug: string, contactId: string | null,
): Promise<{ error?: string }> {
  const guard = await assertOwnerOrAdmin(orgId)
  if (guard.error) return guard
  const service = createServiceClient()
  const { error } = await service.from('sales_orders')
    .update({ contact_id: contactId })
    .eq('id', soId).eq('organization_id', orgId)
  if (error) return { error: error.message }
  revalidatePath(`/dashboard/${orgSlug}/sales-orders/${soId}`)
  return {}
}

// ── Job ───────────────────────────────────────────────────────────────────────

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
