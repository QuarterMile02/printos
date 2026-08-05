'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { generatePromoCode } from '@/lib/promo-code'

export async function regeneratePromoCode(): Promise<string> {
  return generatePromoCode()
}

export async function savePromoCode(formData: FormData) {
  const id = formData.get('id') as string | null
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const name = (formData.get('name') as string).trim()
  const code = (formData.get('code') as string).trim().toUpperCase()
  const discount_type = formData.get('discount_type') as string
  const value = parseFloat(formData.get('value') as string) || 0
  const minimumRaw = (formData.get('minimum_requirement') as string) ?? ''
  const minimum_requirement = minimumRaw.trim() ? parseFloat(minimumRaw) : null
  const limit_of_using = parseInt(formData.get('limit_of_using') as string, 10) || 0
  const valid_from = (formData.get('valid_from') as string) || null
  const valid_to = (formData.get('valid_to') as string) || null
  const is_active = formData.get('is_active') === 'on'

  const editUrl = `/dashboard/${orgSlug}/settings/promo-codes/${id ?? 'new'}`
  if (!name) redirect(`${editUrl}?error=${encodeURIComponent('Name is required.')}`)
  if (!code) redirect(`${editUrl}?error=${encodeURIComponent('Code is required.')}`)

  const service = createServiceClient()

  let savedId = id
  if (id) {
    const { error } = await service.from('promo_codes').update({
      name, code, discount_type, value, minimum_requirement, limit_of_using,
      valid_from, valid_to, is_active, updated_at: new Date().toISOString(),
    }).eq('id', id)
    if (error) redirect(`${editUrl}?error=${encodeURIComponent(error.message)}`)
  } else {
    const { data, error } = await service.from('promo_codes').insert({
      organization_id: orgId, name, code, discount_type, value, minimum_requirement,
      limit_of_using, valid_from, valid_to, is_active,
    }).select('id').single()
    if (error) redirect(`${editUrl}?error=${encodeURIComponent(error.message)}`)
    savedId = (data as { id: string } | null)?.id ?? null
  }

  redirect(`/dashboard/${orgSlug}/settings/promo-codes/${savedId}?saved=1`)
}

export async function deletePromoCode(formData: FormData) {
  const id = formData.get('id') as string
  const orgSlug = formData.get('orgSlug') as string
  const service = createServiceClient()

  // Delete requires deactivation first, same as every other section. There
  // is no linked-record check here yet -- promo codes aren't wired into any
  // checkout flow, so no redemption/usage-tracking table exists to check
  // against. Add one here once real redemption tracking exists.
  const { data: promo } = await service.from('promo_codes').select('is_active').eq('id', id).maybeSingle()
  if (promo?.is_active !== false) {
    redirect(`/dashboard/${orgSlug}/settings/promo-codes/${id}?error=${encodeURIComponent('Cannot delete — promo code must be deactivated first.')}`)
  }

  const { error } = await service.from('promo_codes').delete().eq('id', id)
  if (error) redirect(`/dashboard/${orgSlug}/settings/promo-codes/${id}?error=${encodeURIComponent(error.message)}`)
  redirect(`/dashboard/${orgSlug}/settings/promo-codes`)
}
