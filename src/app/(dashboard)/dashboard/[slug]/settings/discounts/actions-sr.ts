'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function saveDiscount(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = formData.get('name') as string
  const discount_type = formData.get('discount_type') as string
  const applies_to = formData.get('applies_to') as string
  const discount_by = formData.get('discount_by') as string
  const active = formData.get('active') === 'on'

  const service = createServiceClient()

  const editUrl = `/dashboard/${orgSlug}/settings/discounts/${id ?? 'new'}`

  let discountId = id
  if (id) {
    const { error } = await service.from('discounts').update({
      name, discount_type, applies_to, discount_by, active,
      updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) redirect(`${editUrl}?error=${encodeURIComponent(error.message)}`)
  } else {
    const { data, error } = await service.from('discounts').insert({
      organization_id: orgId, name, discount_type, applies_to, discount_by, active,
    }).select('id').single()
    if (error) redirect(`${editUrl}?error=${encodeURIComponent(error.message)}`)
    discountId = (data as { id: string } | null)?.id ?? null
  }

  // Save tiers — delete existing and re-insert
  if (discountId) {
    const { error: delErr } = await service.from('discount_tiers').delete().eq('discount_id', discountId)
    if (delErr) redirect(`/dashboard/${orgSlug}/settings/discounts/${discountId}?error=${encodeURIComponent(delErr.message)}`)

    const tierCount = parseInt(formData.get('tierCount') as string) || 0
    const tiers = []
    for (let i = 0; i < tierCount; i++) {
      const minQty = parseFloat(formData.get(`tier_min_${i}`) as string) || 0
      const maxQty = parseFloat(formData.get(`tier_max_${i}`) as string) || 0
      const discountPercent = parseFloat(formData.get(`tier_pct_${i}`) as string) || 0
      tiers.push({
        discount_id: discountId,
        min_qty: minQty,
        max_qty: maxQty,
        discount_percent: discountPercent,
        sort_order: i + 1,
      })
    }
    if (tiers.length > 0) {
      const { error: insErr } = await service.from('discount_tiers').insert(tiers)
      if (insErr) redirect(`/dashboard/${orgSlug}/settings/discounts/${discountId}?error=${encodeURIComponent(insErr.message)}`)
    }
  }

  redirect(`/dashboard/${orgSlug}/settings/discounts`)
}

export async function deleteDiscount(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()

  // Delete requires BOTH: already deactivated, AND zero linked records.
  const { data: discount } = await service.from('discounts').select('active').eq('id', id).maybeSingle()
  if (discount?.active !== false) {
    redirect(`/dashboard/${orgSlug}/settings/discounts/${id}?error=${encodeURIComponent('Cannot delete — discount must be deactivated first.')}`)
  }

  // A discount can be referenced from 5 different tables (6 columns) --
  // products' two FK columns have no ON DELETE clause (default RESTRICT), so
  // an unguarded delete would previously throw a raw FK-violation error;
  // materials/customers/labor_rates/machine_rates all SET NULL, so it would
  // otherwise silently unassign the discount with no warning. Block instead,
  // matching every other section's "in use" convention.
  const [products1, products2, materials, customers, laborRates, machineRates] = await Promise.all([
    service.from('products').select('id', { count: 'exact', head: true }).eq('volume_discount_id', id),
    service.from('products').select('id', { count: 'exact', head: true }).eq('range_discount_id', id),
    service.from('materials').select('id', { count: 'exact', head: true }).eq('discount_id', id),
    service.from('customers').select('id', { count: 'exact', head: true }).eq('discount_id', id),
    service.from('labor_rates').select('id', { count: 'exact', head: true }).eq('volume_discount_id', id),
    service.from('machine_rates').select('id', { count: 'exact', head: true }).eq('volume_discount_id', id),
  ])

  const productCount = (products1.count ?? 0) + (products2.count ?? 0)
  const linked: string[] = []
  if (productCount > 0) linked.push(`${productCount} product${productCount === 1 ? '' : 's'}`)
  if ((materials.count ?? 0) > 0) linked.push(`${materials.count} material${materials.count === 1 ? '' : 's'}`)
  if ((customers.count ?? 0) > 0) linked.push(`${customers.count} customer${customers.count === 1 ? '' : 's'}`)
  if ((laborRates.count ?? 0) > 0) linked.push(`${laborRates.count} labor rate${laborRates.count === 1 ? '' : 's'}`)
  if ((machineRates.count ?? 0) > 0) linked.push(`${machineRates.count} machine rate${machineRates.count === 1 ? '' : 's'}`)

  if (linked.length > 0) {
    redirect(`/dashboard/${orgSlug}/settings/discounts/${id}?error=${encodeURIComponent(`Cannot delete — linked to ${linked.join(', ')}. Modify those first.`)}`)
  }

  const { error: tierErr } = await service.from('discount_tiers').delete().eq('discount_id', id)
  if (tierErr) redirect(`/dashboard/${orgSlug}/settings/discounts/${id}?error=${encodeURIComponent(tierErr.message)}`)
  const { error } = await service.from('discounts').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/discounts/${id}?error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/discounts`)
}
