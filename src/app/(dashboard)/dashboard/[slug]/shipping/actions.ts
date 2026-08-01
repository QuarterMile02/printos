'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

function numOrNull(v: FormDataEntryValue | null): number | null {
  const n = parseFloat(v as string)
  return isNaN(n) ? null : n
}

export type CustomerShippingInfo = {
  id: string
  name: string
  company_name: string | null
  shipping_method: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
}

// Fetches the address/preference fields the new-shipment form needs for a
// selected customer — separate from the lighter search-result shape used by
// the picker, since those don't carry address/shipping_method.
export async function getCustomerShippingInfo(orgId: string, customerId: string): Promise<CustomerShippingInfo | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('customers')
    .select('id, first_name, last_name, company_name, shipping_method, street, city, state, zip')
    .eq('organization_id', orgId)
    .eq('id', customerId)
    .maybeSingle()
  if (!data) return null
  const row = data as {
    id: string; first_name: string; last_name: string; company_name: string | null
    shipping_method: string | null; street: string | null; city: string | null; state: string | null; zip: string | null
  }
  return {
    id: row.id,
    name: `${row.first_name} ${row.last_name}`.trim(),
    company_name: row.company_name,
    shipping_method: row.shipping_method,
    street: row.street,
    city: row.city,
    state: row.state,
    zip: row.zip,
  }
}

export async function createShipment(formData: FormData) {
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const sales_order_id = (formData.get('sales_order_id') as string) || null
  const customer_id = (formData.get('customer_id') as string) || null
  const shipping_method_id = (formData.get('shipping_method_id') as string) || null
  const shipping_profile_id = (formData.get('shipping_profile_id') as string) || null
  const weight_lbs = numOrNull(formData.get('weight_lbs'))
  const length_in = numOrNull(formData.get('length_in'))
  const width_in = numOrNull(formData.get('width_in'))
  const height_in = numOrNull(formData.get('height_in'))
  const status = (formData.get('status') as string) || 'pending'
  const tracking_number = ((formData.get('tracking_number') as string) ?? '').trim() || null
  const carrier = ((formData.get('carrier') as string) ?? '').trim() || null
  const quoted_rate = numOrNull(formData.get('quoted_rate'))
  const actual_cost = numOrNull(formData.get('actual_cost'))
  const label_url = ((formData.get('label_url') as string) ?? '').trim() || null
  const easypost_shipment_id = ((formData.get('easypost_shipment_id') as string) ?? '').trim() || null
  const easypost_tracker_id = ((formData.get('easypost_tracker_id') as string) ?? '').trim() || null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const service = createServiceClient()

  const { error } = await service.from('shipments').insert({
    organization_id: orgId,
    sales_order_id,
    customer_id,
    shipping_method_id,
    shipping_profile_id,
    weight_lbs,
    length_in,
    width_in,
    height_in,
    status,
    tracking_number,
    carrier,
    quoted_rate,
    actual_cost,
    label_url,
    easypost_shipment_id,
    easypost_tracker_id,
    created_by: user?.id ?? null,
  })

  if (error) {
    redirect(`/dashboard/${orgSlug}/shipping/new?error=${encodeURIComponent(error.message)}`)
  }

  redirect(`/dashboard/${orgSlug}/shipping?created=1`)
}
