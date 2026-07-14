'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

function numOrNull(v: FormDataEntryValue | null): number | null {
  const n = parseFloat(v as string)
  return isNaN(n) ? null : n
}

export async function saveShipment(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const soId = formData.get('soId') as string
  const shipping_method_id = (formData.get('shipping_method_id') as string) || null
  const tracking_number = ((formData.get('tracking_number') as string) ?? '').trim() || null
  const shipped_date = (formData.get('shipped_date') as string) || null
  const estimated_delivery = (formData.get('estimated_delivery') as string) || null
  const notes = ((formData.get('notes') as string) ?? '').trim() || null
  const status = (formData.get('status') as string) || 'pending'
  const shipping_profile_id = (formData.get('shipping_profile_id') as string) || null
  const weight_lbs = numOrNull(formData.get('weight_lbs'))
  const length_in = numOrNull(formData.get('length_in'))
  const width_in = numOrNull(formData.get('width_in'))
  const height_in = numOrNull(formData.get('height_in'))
  const quoted_rate = numOrNull(formData.get('quoted_rate'))
  const actual_cost = numOrNull(formData.get('actual_cost'))

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const service = createServiceClient()

  const payload = {
    shipping_method_id,
    tracking_number,
    shipped_date,
    estimated_delivery,
    notes,
    status,
    shipping_profile_id,
    weight_lbs,
    length_in,
    width_in,
    height_in,
    quoted_rate,
    actual_cost,
  }

  if (id) {
    await service.from('shipments').update(payload).eq('id', id)
  } else {
    await service.from('shipments').insert({
      ...payload,
      organization_id: orgId,
      sales_order_id: soId,
      created_by: user?.id ?? null,
    })
  }

  redirect(`/dashboard/${orgSlug}/sales-orders/${soId}?shipment_saved=1`)
}

export async function deleteShipment(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const soId = formData.get('soId') as string
  const service = createServiceClient()
  await service.from('shipments').delete().eq('id', id)
  redirect(`/dashboard/${orgSlug}/sales-orders/${soId}`)
}
