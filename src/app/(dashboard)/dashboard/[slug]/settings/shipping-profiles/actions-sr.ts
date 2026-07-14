'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

function numOrNull(v: FormDataEntryValue | null): number | null {
  const n = parseFloat(v as string)
  return isNaN(n) ? null : n
}

export async function saveShippingProfile(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const length_in = numOrNull(formData.get('length_in'))
  const width_in = numOrNull(formData.get('width_in'))
  const height_in = numOrNull(formData.get('height_in'))
  const max_weight_lbs = numOrNull(formData.get('max_weight_lbs'))
  const is_active = formData.get('is_active') === 'on'

  const service = createServiceClient()
  let savedId = id
  if (id) {
    await service.from('shipping_profiles').update({ name, length_in, width_in, height_in, max_weight_lbs, is_active }).eq('id', id)
  } else {
    const { data } = await service
      .from('shipping_profiles')
      .insert({ organization_id: orgId, name, length_in, width_in, height_in, max_weight_lbs, is_active })
      .select('id').single()
    savedId = (data as { id: string } | null)?.id ?? null
  }
  redirect(savedId
    ? `/dashboard/${orgSlug}/settings/shipping-profiles?edit=${savedId}&saved=1`
    : `/dashboard/${orgSlug}/settings/shipping-profiles`)
}
