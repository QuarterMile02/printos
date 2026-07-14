'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveShippingMethod(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const carrier = (formData.get('carrier') as string) || null
  const is_active = formData.get('is_active') === 'on'

  const service = createServiceClient()
  let savedId = id
  if (id) {
    await service.from('shipping_methods').update({ name, carrier, is_active }).eq('id', id)
  } else {
    const { data } = await service
      .from('shipping_methods')
      .insert({ organization_id: orgId, name, carrier, is_active })
      .select('id').single()
    savedId = (data as { id: string } | null)?.id ?? null
  }
  redirect(savedId
    ? `/dashboard/${orgSlug}/settings/shipping-methods?edit=${savedId}&saved=1`
    : `/dashboard/${orgSlug}/settings/shipping-methods`)
}
