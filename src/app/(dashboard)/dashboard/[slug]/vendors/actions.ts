'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { revalidatePath } from 'next/cache'

function t(v: string | null | undefined) { return v?.trim() || null }

export type VendorListRow = {
  id: string
  name: string
  primary_contact: string | null
  primary_phone: string | null
  primary_email: string | null
  city: string | null
  state: string | null
  is_active: boolean | null
  created_at: string
}

export async function createVendor(
  orgId: string,
  orgSlug: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const name = t(formData.get('name') as string | null)
  if (!name) return { error: 'Company name is required.' }

  const { allowed } = await checkPermission(orgId, 'customers.create')
  if (!allowed) return { error: 'You do not have permission to create vendors.' }

  const service = createServiceClient()
  const { error } = await service.from('vendors').insert({
    organization_id: orgId,
    name,
    primary_contact: t(formData.get('primary_contact') as string | null),
    primary_email: t(formData.get('primary_email') as string | null),
    primary_phone: t(formData.get('primary_phone') as string | null),
    website: t(formData.get('website') as string | null),
    background_info: t(formData.get('notes') as string | null),
  })
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/vendors`)
  return {}
}

export async function searchVendors(
  orgId: string,
  term: string,
): Promise<VendorListRow[]> {
  const service = createServiceClient()

  // Try trigram fuzzy search (requires pg_trgm + 062 migration)
  try {
    const { data: fuzzyData, error } = await service.rpc('search_vendors_fuzzy', {
      p_org_id: orgId,
      p_term: term,
    }) as { data: VendorListRow[] | null; error: unknown }
    if (!error && fuzzyData) return fuzzyData
  } catch {
    // pg_trgm not installed — fall through
  }

  // Fallback: ILIKE search
  const digits = term.replace(/\D/g, '')
  const conds = [
    `name.ilike.%${term}%`,
    `primary_contact.ilike.%${term}%`,
    `primary_email.ilike.%${term}%`,
    `city.ilike.%${term}%`,
    `primary_phone.ilike.%${term}%`,
  ]
  if (digits && digits !== term) conds.push(`primary_phone.ilike.%${digits}%`)

  const { data } = await service
    .from('vendors')
    .select('id, name, primary_contact, primary_phone, primary_email, city, state, is_active, created_at')
    .eq('organization_id', orgId)
    .or(conds.join(','))
    .order('name', { ascending: true })
    .limit(50)
  return (data ?? []) as VendorListRow[]
}

export async function deleteVendor(
  vendorId: string,
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
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return { error: 'Only owners and admins can delete vendors.' }
  }

  const service = createServiceClient()

  // Get vendor name for material_vendors lookup (FK is by name, not ID)
  const { data: vendor } = await service
    .from('vendors').select('name').eq('id', vendorId).eq('organization_id', orgId).single()
  if (!vendor) return { error: 'Vendor not found.' }

  const { count: matCount } = await service
    .from('material_vendors')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('vendor_name', vendor.name)

  if ((matCount ?? 0) > 0) {
    return { error: `Cannot delete — vendor is linked to ${matCount} material${matCount === 1 ? '' : 's'}. Deactivate instead.` }
  }

  const { error } = await service.from('vendors').delete().eq('id', vendorId).eq('organization_id', orgId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/vendors`)
  return {}
}

export async function deactivateVendor(
  vendorId: string,
  orgId: string,
  orgSlug: string,
): Promise<{ error?: string }> {
  const { allowed } = await checkPermission(orgId, 'customers.create')
  if (!allowed) return { error: 'You do not have permission to deactivate vendors.' }

  const service = createServiceClient()
  const { error } = await service
    .from('vendors').update({ is_active: false }).eq('id', vendorId).eq('organization_id', orgId)
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/vendors/${vendorId}`)
  revalidatePath(`/dashboard/${orgSlug}/vendors`)
  return {}
}

export async function loadMoreVendors(
  orgId: string,
  search: string,
  offset: number,
): Promise<VendorListRow[]> {
  const service = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = service
    .from('vendors')
    .select('id, name, primary_contact, primary_phone, primary_email, city, state, is_active, created_at')
    .eq('organization_id', orgId)
    .order('name', { ascending: true })

  if (search.trim()) {
    const q = search.trim()
    query = query.or(
      `name.ilike.%${q}%,primary_contact.ilike.%${q}%,primary_email.ilike.%${q}%,primary_phone.ilike.%${q}%,city.ilike.%${q}%`
    )
  }

  query = query.range(offset, offset + 49)
  const { data } = await query
  return (data ?? []) as VendorListRow[]
}
