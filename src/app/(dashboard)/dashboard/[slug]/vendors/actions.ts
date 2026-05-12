'use server'

import { createServiceClient } from '@/lib/supabase/server'
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
