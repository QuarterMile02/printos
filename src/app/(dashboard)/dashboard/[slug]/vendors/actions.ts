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

  const g = (key: string) => t(formData.get(key) as string | null)

  const service = createServiceClient()
  const { error } = await service.from('vendors').insert({
    organization_id: orgId,
    name,
    legal_name: g('legal_name'),
    primary_contact: g('primary_contact'),
    primary_email: g('primary_email'),
    primary_phone: g('primary_phone'),
    website: g('website'),
    // Checkbox: present in FormData (any value) only when checked --
    // absence means unchecked, not "field omitted."
    is_active: formData.get('is_active') !== null,
    street: g('street'),
    city: g('city'),
    state: g('state'),
    zip: g('zip'),
    country: g('country'),
    secondary_street: g('secondary_street'),
    secondary_city: g('secondary_city'),
    secondary_state: g('secondary_state'),
    secondary_zip: g('secondary_zip'),
    account_id: g('account_id'),
    tax_id: g('tax_id'),
    tax: g('tax'),
    terms: g('terms'),
    payment_method: g('payment_method'),
    catalog_url: g('catalog_url'),
    categories: g('categories'),
    hours_of_operation: g('hours_of_operation'),
    background_info: g('notes'),
  })
  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/vendors`)
  return {}
}

export async function searchVendors(
  orgId: string,
  term: string,
  activeOnly?: boolean,
): Promise<VendorListRow[]> {
  const service = createServiceClient()

  // Try trigram fuzzy search (requires pg_trgm + 062 migration)
  try {
    const { data: fuzzyData, error } = await service.rpc('search_vendors_fuzzy', {
      p_org_id: orgId,
      p_term: term,
    }) as { data: VendorListRow[] | null; error: unknown }
    if (!error && fuzzyData) {
      // The RPC has no active-status param -- filter its results here
      // instead of altering the DB function.
      return activeOnly === undefined ? fuzzyData : fuzzyData.filter((v) => v.is_active === activeOnly)
    }
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

  let query = service
    .from('vendors')
    .select('id, name, primary_contact, primary_phone, primary_email, city, state, is_active, created_at')
    .eq('organization_id', orgId)
    .or(conds.join(','))
  if (activeOnly !== undefined) query = query.eq('is_active', activeOnly)

  const { data } = await query.order('name', { ascending: true }).limit(50)
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
    .from('vendors').select('name, is_active').eq('id', vendorId).eq('organization_id', orgId).single()
  if (!vendor) return { error: 'Vendor not found.' }

  // Delete requires BOTH: already deactivated, AND zero linked records.
  if (vendor.is_active !== false) {
    return { error: 'Cannot delete — vendor must be deactivated first.' }
  }

  const { count: matCount } = await service
    .from('material_vendors')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('vendor_name', vendor.name)

  if ((matCount ?? 0) > 0) {
    return { error: `Cannot delete — vendor is linked to ${matCount} material${matCount === 1 ? '' : 's'}. Modify those first.` }
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
