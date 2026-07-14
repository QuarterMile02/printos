'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveShipment(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const soId = formData.get('soId') as string
  const carrier = (formData.get('carrier') as string) || null
  const tracking_number = ((formData.get('tracking_number') as string) ?? '').trim() || null
  const shipped_date = (formData.get('shipped_date') as string) || null
  const estimated_delivery = (formData.get('estimated_delivery') as string) || null
  const notes = ((formData.get('notes') as string) ?? '').trim() || null
  const status = (formData.get('status') as string) || 'pending'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const service = createServiceClient()

  if (id) {
    await service.from('shipments')
      .update({ carrier, tracking_number, shipped_date, estimated_delivery, notes, status })
      .eq('id', id)
  } else {
    await service.from('shipments').insert({
      organization_id: orgId,
      sales_order_id: soId,
      carrier,
      tracking_number,
      shipped_date,
      estimated_delivery,
      notes,
      status,
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
