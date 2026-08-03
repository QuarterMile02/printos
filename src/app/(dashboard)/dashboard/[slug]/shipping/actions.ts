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

function parseShipmentFields(formData: FormData) {
  return {
    sales_order_id: (formData.get('sales_order_id') as string) || null,
    customer_id: (formData.get('customer_id') as string) || null,
    shipping_method_id: (formData.get('shipping_method_id') as string) || null,
    shipping_profile_id: (formData.get('shipping_profile_id') as string) || null,
    ship_to_name: ((formData.get('ship_to_name') as string) ?? '').trim() || null,
    ship_to_street: ((formData.get('ship_to_street') as string) ?? '').trim() || null,
    ship_to_city: ((formData.get('ship_to_city') as string) ?? '').trim() || null,
    ship_to_state: ((formData.get('ship_to_state') as string) ?? '').trim() || null,
    ship_to_zip: ((formData.get('ship_to_zip') as string) ?? '').trim() || null,
    weight_lbs: numOrNull(formData.get('weight_lbs')),
    length_in: numOrNull(formData.get('length_in')),
    width_in: numOrNull(formData.get('width_in')),
    height_in: numOrNull(formData.get('height_in')),
    status: (formData.get('status') as string) || 'pending',
    tracking_number: ((formData.get('tracking_number') as string) ?? '').trim() || null,
    carrier: ((formData.get('carrier') as string) ?? '').trim() || null,
    quoted_rate: numOrNull(formData.get('quoted_rate')),
    actual_cost: numOrNull(formData.get('actual_cost')),
    label_url: ((formData.get('label_url') as string) ?? '').trim() || null,
    easypost_shipment_id: ((formData.get('easypost_shipment_id') as string) ?? '').trim() || null,
    easypost_tracker_id: ((formData.get('easypost_tracker_id') as string) ?? '').trim() || null,
  }
}

// Local/pickup shipping methods skip EasyPost rate-shopping entirely and
// instead get a task assigned to whoever is doing the delivery or handling
// the pickup — reuses the existing tasks table/assignment mechanism (which
// already has a working "Assign To" picker) rather than jobs.assigned_to,
// which no UI in the app currently writes to.
async function upsertDeliveryTask(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  orgId: string,
  userId: string | null,
  shipmentId: string,
  soId: string | null,
  notes: string | null,
  assignedTo: string | null,
) {
  const { data: existing } = await service
    .from('tasks')
    .select('id')
    .eq('shipment_id', shipmentId)
    .maybeSingle() as { data: { id: string } | null }

  const taskFields = {
    org_id: orgId,
    title: 'Delivery / Pickup',
    description: notes,
    assigned_to: assignedTo,
    so_id: soId,
    shipment_id: shipmentId,
  }

  if (existing) {
    const { error } = await service.from('tasks').update(taskFields).eq('id', existing.id)
    return error?.message ?? null
  }
  const { error } = await service.from('tasks').insert({ ...taskFields, created_by: userId, status: 'open', priority: 'medium' })
  return error?.message ?? null
}

async function isLocalOrPickupMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any,
  shippingMethodId: string | null,
): Promise<boolean> {
  if (!shippingMethodId) return false
  const { data } = await service
    .from('shipping_methods')
    .select('carrier')
    .eq('id', shippingMethodId)
    .maybeSingle() as { data: { carrier: string | null } | null }
  return data?.carrier === 'local' || data?.carrier === 'pickup'
}

export async function createShipment(formData: FormData) {
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const fields = parseShipmentFields(formData)
  const deliveryNotes = ((formData.get('delivery_notes') as string) ?? '').trim() || null
  const taskAssignedTo = (formData.get('task_assigned_to') as string) || null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const service = createServiceClient()

  const { data: inserted, error } = await service.from('shipments').insert({
    organization_id: orgId,
    ...fields,
    created_by: user?.id ?? null,
  }).select('id').single() as { data: { id: string } | null; error: { message: string } | null }

  if (error || !inserted) {
    redirect(`/dashboard/${orgSlug}/shipping/new?error=${encodeURIComponent(error?.message ?? 'Failed to create shipment')}`)
  }

  if (await isLocalOrPickupMethod(service, fields.shipping_method_id)) {
    const taskError = await upsertDeliveryTask(service, orgId, user?.id ?? null, inserted.id, fields.sales_order_id, deliveryNotes, taskAssignedTo)
    if (taskError) {
      redirect(`/dashboard/${orgSlug}/shipping/${inserted.id}?error=${encodeURIComponent(`Shipment saved, but the delivery task failed: ${taskError}`)}`)
    }
  }

  // Created from a Sales Order's context (linked via sales_order_id) — land
  // back on that SO rather than the org-wide list, same flash-banner pattern
  // the SO detail page already uses for its own writes.
  if (fields.sales_order_id) {
    redirect(`/dashboard/${orgSlug}/sales-orders/${fields.sales_order_id}?shipment_saved=1`)
  }

  redirect(`/dashboard/${orgSlug}/shipping?created=1`)
}

export async function updateShipment(formData: FormData) {
  const id = formData.get('id') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const fields = parseShipmentFields(formData)
  const deliveryNotes = ((formData.get('delivery_notes') as string) ?? '').trim() || null
  const taskAssignedTo = (formData.get('task_assigned_to') as string) || null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const service = createServiceClient()

  const { error } = await service.from('shipments')
    .update(fields)
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) {
    redirect(`/dashboard/${orgSlug}/shipping/${id}?error=${encodeURIComponent(error.message)}`)
  }

  if (await isLocalOrPickupMethod(service, fields.shipping_method_id)) {
    const taskError = await upsertDeliveryTask(service, orgId, user?.id ?? null, id, fields.sales_order_id, deliveryNotes, taskAssignedTo)
    if (taskError) {
      redirect(`/dashboard/${orgSlug}/shipping/${id}?error=${encodeURIComponent(`Shipment saved, but the delivery task failed: ${taskError}`)}`)
    }
  }

  redirect(`/dashboard/${orgSlug}/shipping/${id}`)
}

export async function deleteShipment(formData: FormData) {
  const id = formData.get('id') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const soId = (formData.get('soId') as string) || null
  const service = createServiceClient()

  const { error } = await service.from('shipments').delete().eq('id', id).eq('organization_id', orgId)

  const backTarget = soId ? `/dashboard/${orgSlug}/sales-orders/${soId}` : `/dashboard/${orgSlug}/shipping`
  if (error) {
    redirect(`${backTarget}?shipment_error=${encodeURIComponent(error.message)}`)
  }
  redirect(backTarget)
}
