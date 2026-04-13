'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function addRecipeItem(formData: FormData) {
  const productId = formData.get('productId') as string
  const orgId = formData.get('orgId') as string
  const orgSlug = formData.get('orgSlug') as string
  const itemType = formData.get('itemType') as string
  const rateId = formData.get('rateId') as string
  const systemFormula = formData.get('systemFormula') as string
  const multiplier = parseFloat(formData.get('multiplier') as string) || 1
  const includeInBasePrice = formData.get('includeInBasePrice') === 'on'
  const chargePerLiUnit = formData.get('chargePerLiUnit') === 'on'

  const service = createServiceClient()

  // Get next sort_order
  const { data: existing } = await service
    .from('product_default_items')
    .select('sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: false })
    .limit(1)
  const nextSort = ((existing as { sort_order: number }[] | null)?.[0]?.sort_order ?? -1) + 1

  const insert: Record<string, unknown> = {
    product_id: productId,
    organization_id: orgId,
    item_type: itemType,
    system_formula: systemFormula || null,
    multiplier,
    include_in_base_price: includeInBasePrice,
    charge_per_li_unit: chargePerLiUnit,
    sort_order: nextSort,
  }

  if (itemType === 'Material') insert.material_id = rateId || null
  if (itemType === 'LaborRate') insert.labor_rate_id = rateId || null
  if (itemType === 'MachineRate') insert.machine_rate_id = rateId || null

  const { error } = await service.from('product_default_items').insert(insert)
  if (error) {
    console.error('[addRecipeItem] Insert failed:', error.message)
    throw new Error(error.message)
  }

  redirect(`/dashboard/${orgSlug}/products/${productId}`)
}

export async function deleteRecipeItem(formData: FormData) {
  const itemId = formData.get('itemId') as string
  const productId = formData.get('productId') as string
  const orgSlug = formData.get('orgSlug') as string

  const service = createServiceClient()
  await service.from('product_default_items').delete().eq('id', itemId)

  redirect(`/dashboard/${orgSlug}/products/${productId}`)
}
