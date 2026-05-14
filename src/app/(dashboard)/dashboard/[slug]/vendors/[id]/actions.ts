'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { revalidatePath } from 'next/cache'

function t(v: string | null | undefined) { return v?.trim() || null }

export type VendorUpdatePayload = {
  name?: string
  legal_name?: string | null
  primary_contact?: string | null
  primary_email?: string | null
  primary_phone?: string | null
  website?: string | null
  catalog_url?: string | null
  account_id?: string | null
  tax_id?: string | null
  tax?: string | null
  terms?: string | null
  payment_method?: string | null
  categories?: string | null
  hours_of_operation?: string | null
  background_info?: string | null
  is_active?: boolean | null
  street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  secondary_street?: string | null
  secondary_city?: string | null
  secondary_state?: string | null
  secondary_zip?: string | null
}

export async function updateVendor(
  vendorId: string,
  orgId: string,
  orgSlug: string,
  payload: VendorUpdatePayload,
): Promise<{ error?: string }> {
  const { allowed } = await checkPermission(orgId, 'customers.create')
  if (!allowed) return { error: 'You do not have permission to update vendors.' }

  const service = createServiceClient()

  const update: Record<string, unknown> = {}

  if (payload.name !== undefined) {
    const name = t(payload.name)
    if (!name) return { error: 'Company name is required.' }
    update.name = name
  }

  const textFields = [
    'legal_name', 'primary_contact', 'primary_email', 'primary_phone',
    'website', 'catalog_url', 'account_id', 'tax_id', 'tax', 'terms',
    'payment_method', 'categories', 'hours_of_operation', 'background_info',
    'street', 'city', 'state', 'zip', 'country',
    'secondary_street', 'secondary_city', 'secondary_state', 'secondary_zip',
  ] as const
  for (const field of textFields) {
    if (payload[field] !== undefined) update[field] = t(payload[field])
  }

  if (payload.is_active !== undefined) update.is_active = payload.is_active

  const { error } = await service
    .from('vendors')
    .update(update)
    .eq('id', vendorId)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/vendors`)
  revalidatePath(`/dashboard/${orgSlug}/vendors/${vendorId}`)
  return {}
}
