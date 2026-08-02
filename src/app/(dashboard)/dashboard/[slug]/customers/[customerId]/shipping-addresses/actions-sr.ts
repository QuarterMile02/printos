'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { dbOrThrow } from '@/lib/db'

export async function saveShippingAddress(formData: FormData) {
  const id        = (formData.get('id') as string) || null
  const orgId     = formData.get('orgId') as string
  const customerId = formData.get('customerId') as string
  const orgSlug   = formData.get('orgSlug') as string
  const label     = ((formData.get('label') as string) ?? '').trim() || null
  const street    = ((formData.get('street') as string) ?? '').trim() || null
  const city      = ((formData.get('city') as string) ?? '').trim() || null
  const state     = ((formData.get('state') as string) ?? '').trim() || null
  const zip       = ((formData.get('zip') as string) ?? '').trim() || null
  const country   = ((formData.get('country') as string) ?? 'US').trim() || 'US'
  const isDefault = formData.get('is_default') === 'on'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const service = createServiceClient()

  if (isDefault) {
    await dbOrThrow(service.from('shipping_addresses')
      .update({ is_default: false })
      .eq('customer_id', customerId)
      .eq('organization_id', orgId))
  }

  const payload = { label, street, city, state, zip, country, is_default: isDefault }

  if (id) {
    await dbOrThrow(service.from('shipping_addresses').update(payload).eq('id', id))
  } else {
    await dbOrThrow(service.from('shipping_addresses').insert({
      ...payload,
      organization_id: orgId,
      customer_id: customerId,
    }))
  }

  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
}

export async function deleteShippingAddress(formData: FormData) {
  const id       = formData.get('id') as string
  const orgSlug  = formData.get('orgSlug') as string
  const customerId = formData.get('customerId') as string

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const service = createServiceClient()
  await dbOrThrow(service.from('shipping_addresses').delete().eq('id', id))

  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
}

export async function setDefaultShippingAddress(formData: FormData) {
  const id         = formData.get('id') as string
  const orgId      = formData.get('orgId') as string
  const customerId = formData.get('customerId') as string
  const orgSlug    = formData.get('orgSlug') as string

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const service = createServiceClient()
  await dbOrThrow(service.from('shipping_addresses').update({ is_default: false })
    .eq('customer_id', customerId).eq('organization_id', orgId))
  await dbOrThrow(service.from('shipping_addresses').update({ is_default: true }).eq('id', id))

  revalidatePath(`/dashboard/${orgSlug}/customers/${customerId}`)
}
