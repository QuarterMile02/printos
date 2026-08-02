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
  const { error: tierErr } = await service.from('discount_tiers').delete().eq('discount_id', id)
  if (tierErr) redirect(`/dashboard/${orgSlug}/settings/discounts/${id}?error=${encodeURIComponent(tierErr.message)}`)
  const { error } = await service.from('discounts').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/discounts/${id}?error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/discounts`)
}
