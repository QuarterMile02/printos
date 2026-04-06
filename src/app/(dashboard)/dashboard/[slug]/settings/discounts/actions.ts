'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import type { DiscountType, DiscountAppliesTo, DiscountBy } from '@/types/product-builder'

export type DiscountFormData = {
  name: string
  discount_type: DiscountType
  applies_to: DiscountAppliesTo
  discount_by: DiscountBy
  active: boolean
}

export type TierRowInput = {
  min_qty: number
  max_qty: number | null
  discount_percent: number | null
  fixed_price: number | null
}

async function getMembership(orgId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { user: null, membership: null }
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: OrgRole } | null; error: unknown }
  return { user, membership }
}

async function replaceTiers(discountId: string, tiers: TierRowInput[]) {
  const service = createServiceClient()
  await service.from('discount_tiers').delete().eq('discount_id', discountId)

  if (tiers.length > 0) {
    const rows = tiers.map((t, i) => ({
      discount_id: discountId,
      min_qty: t.min_qty,
      max_qty: t.max_qty,
      discount_percent: t.discount_percent,
      fixed_price: t.fixed_price,
      sort_order: i,
    }))
    await service.from('discount_tiers').insert(rows)
  }
}

export async function createDiscount(
  orgId: string,
  orgSlug: string,
  data: DiscountFormData,
  tiers: TierRowInput[]
): Promise<{ error?: string; id?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create discounts.' }

  const service = createServiceClient()
  const { data: inserted, error } = await service
    .from('discounts')
    .insert({
      organization_id: orgId,
      name: data.name.trim(),
      discount_type: data.discount_type,
      applies_to: data.applies_to,
      discount_by: data.discount_by,
      active: data.active,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error || !inserted) return { error: error?.message ?? 'Failed to create discount.' }

  await replaceTiers(inserted.id, tiers)

  revalidatePath(`/dashboard/${orgSlug}/settings/discounts`)
  return { id: inserted.id }
}

export async function updateDiscount(
  id: string,
  orgId: string,
  orgSlug: string,
  data: DiscountFormData,
  tiers: TierRowInput[]
): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update discounts.' }

  const service = createServiceClient()
  const { error } = await service
    .from('discounts')
    .update({
      name: data.name.trim(),
      discount_type: data.discount_type,
      applies_to: data.applies_to,
      discount_by: data.discount_by,
      active: data.active,
    })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  await replaceTiers(id, tiers)

  revalidatePath(`/dashboard/${orgSlug}/settings/discounts`)
  return {}
}

export async function toggleDiscountActive(
  id: string,
  orgId: string,
  orgSlug: string,
  active: boolean
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update discounts.' }

  const service = createServiceClient()
  const { error } = await service
    .from('discounts')
    .update({ active })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/discounts`)
  return {}
}
