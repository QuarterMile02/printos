'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { OrgRole } from '@/types/database'
import type { LaborRate } from '@/types/product-builder'

export type LaborRateFormData = {
  name: string
  external_name: string | null
  cost: number
  price: number
  markup: number
  setup_charge: number | null
  machine_charge: number | null
  other_charge: number | null
  formula: string | null
  units: string | null
  include_in_base_price: boolean
  per_li_unit: boolean
  production_rate: number | null
  production_rate_units: string | null
  production_rate_per: string | null
  production_factor: number | null
  production_rate_prompt: string | null
  production_rate_prompt_detail: string | null
  volume_discount_id: string | null
  cog_account: string | null
  cog_account_number: string | null
  qb_item_type: string | null
  description: string | null
  display_name_in_line_item: boolean
  display_description_in_line_item: boolean
  show_internal: boolean
  sop_url: string | null
  video_url: string | null
  active: boolean
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

function calcProfitMargin(cost: number, price: number): number | null {
  if (price <= 0) return null
  return Number(((price - cost) / price * 100).toFixed(2))
}

export async function createLaborRate(
  orgId: string,
  orgSlug: string,
  data: LaborRateFormData
): Promise<{ error?: string; id?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create labor rates.' }

  const service = createServiceClient()
  const { data: inserted, error } = await service
    .from('labor_rates')
    .insert({
      organization_id: orgId,
      name: data.name.trim(),
      external_name: data.external_name?.trim() || null,
      cost: data.cost,
      price: data.price,
      markup: data.markup,
      setup_charge: data.setup_charge,
      machine_charge: data.machine_charge,
      other_charge: data.other_charge,
      formula: data.formula,
      units: data.units,
      include_in_base_price: data.include_in_base_price,
      per_li_unit: data.per_li_unit,
      production_rate: data.production_rate,
      production_rate_units: data.production_rate_units,
      production_rate_per: data.production_rate_per,
      production_factor: data.production_factor,
      production_rate_prompt: data.production_rate_prompt,
      production_rate_prompt_detail: data.production_rate_prompt_detail,
      volume_discount_id: data.volume_discount_id,
      cog_account: data.cog_account,
      cog_account_number: data.cog_account_number,
      qb_item_type: data.qb_item_type,
      description: data.description,
      display_name_in_line_item: data.display_name_in_line_item,
      display_description_in_line_item: data.display_description_in_line_item,
      show_internal: data.show_internal,
      sop_url: data.sop_url,
      video_url: data.video_url,
      profit_margin_pct: calcProfitMargin(data.cost, data.price),
      active: data.active,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/labor-rates`)
  return { id: inserted?.id }
}

export async function updateLaborRate(
  id: string,
  orgId: string,
  orgSlug: string,
  data: LaborRateFormData
): Promise<{ error?: string }> {
  if (!data.name.trim()) return { error: 'Name is required.' }

  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update labor rates.' }

  const service = createServiceClient()
  const { error } = await service
    .from('labor_rates')
    .update({
      name: data.name.trim(),
      external_name: data.external_name?.trim() || null,
      cost: data.cost,
      price: data.price,
      markup: data.markup,
      setup_charge: data.setup_charge,
      machine_charge: data.machine_charge,
      other_charge: data.other_charge,
      formula: data.formula,
      units: data.units,
      include_in_base_price: data.include_in_base_price,
      per_li_unit: data.per_li_unit,
      production_rate: data.production_rate,
      production_rate_units: data.production_rate_units,
      production_rate_per: data.production_rate_per,
      production_factor: data.production_factor,
      production_rate_prompt: data.production_rate_prompt,
      production_rate_prompt_detail: data.production_rate_prompt_detail,
      volume_discount_id: data.volume_discount_id,
      cog_account: data.cog_account,
      cog_account_number: data.cog_account_number,
      qb_item_type: data.qb_item_type,
      description: data.description,
      display_name_in_line_item: data.display_name_in_line_item,
      display_description_in_line_item: data.display_description_in_line_item,
      show_internal: data.show_internal,
      sop_url: data.sop_url,
      video_url: data.video_url,
      profit_margin_pct: calcProfitMargin(data.cost, data.price),
      active: data.active,
      updated_by: user.id,
    })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/labor-rates`)
  return {}
}

export async function toggleLaborRateActive(
  id: string,
  orgId: string,
  orgSlug: string,
  active: boolean
): Promise<{ error?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot update labor rates.' }

  const service = createServiceClient()
  const { error } = await service
    .from('labor_rates')
    .update({ active, updated_by: user.id })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/labor-rates`)
  return {}
}

export async function cloneFromMachineRate(
  machineRateId: string,
  orgId: string,
  orgSlug: string
): Promise<{ error?: string; id?: string }> {
  const { user, membership } = await getMembership(orgId)
  if (!user) return { error: 'Not authenticated.' }
  if (!membership) return { error: 'You are not a member of this organization.' }
  if (membership.role === 'viewer') return { error: 'Viewers cannot create labor rates.' }

  const service = createServiceClient()

  // Fetch the machine rate
  const { data: mr, error: fetchError } = await service
    .from('machine_rates')
    .select('*')
    .eq('id', machineRateId)
    .eq('organization_id', orgId)
    .single()

  if (fetchError || !mr) return { error: fetchError?.message ?? 'Machine rate not found.' }

  // Insert as new labor rate
  const { data: inserted, error: insertError } = await service
    .from('labor_rates')
    .insert({
      organization_id: orgId,
      name: `${mr.name} Labor`,
      external_name: mr.external_name,
      cost: mr.cost,
      price: mr.price,
      markup: mr.markup,
      setup_charge: mr.setup_charge,
      other_charge: mr.other_charge,
      formula: mr.formula,
      units: mr.units,
      include_in_base_price: mr.include_in_base_price,
      per_li_unit: mr.per_li_unit,
      production_rate: mr.production_rate,
      production_rate_units: mr.production_rate_units,
      production_rate_per: mr.production_rate_per,
      volume_discount_id: mr.volume_discount_id,
      cog_account: mr.cog_account,
      cog_account_number: mr.cog_account_number,
      qb_item_type: mr.qb_item_type,
      description: mr.description,
      profit_margin_pct: calcProfitMargin(mr.cost as number, mr.price as number),
      active: true,
      cloned_from_machine_rate_id: machineRateId,
      department_id: mr.department_id,
      created_by: user.id,
      updated_by: user.id,
    })
    .select('id')
    .single()

  if (insertError) return { error: insertError.message }

  revalidatePath(`/dashboard/${orgSlug}/settings/labor-rates`)
  return { id: inserted?.id }
}

export type LaborRateListRow = Pick<
  LaborRate,
  'id' | 'name' | 'cost' | 'price' | 'markup' | 'units' | 'formula' | 'active'
>
