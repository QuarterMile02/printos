'use server'

import { createClient } from '@/lib/supabase/server'

export type ModifierDef = {
  id: string
  system_lookup_name: string
  display_name: string
  modifier_type: string // Boolean, Numeric, Range
  units: string | null
  range_min_value: number | null
  range_max_value: number | null
  range_default_value: number | null
  range_step_interval: number | null
  show_customer: boolean
  show_internal: boolean
  default_value: string | null
  is_required: boolean
}

export async function getProductModifiers(
  productId: string,
  orgId: string,
): Promise<ModifierDef[]> {
  const supabase = await createClient()

  // Get product_modifiers join rows
  const { data: pmRows } = await supabase
    .from('product_modifiers')
    .select('modifier_id, default_value, is_required, sort_order')
    .eq('product_id', productId)
    .eq('organization_id', orgId)
    .order('sort_order')

  const joins = (pmRows ?? []) as { modifier_id: string | null; default_value: string | null; is_required: boolean | null; sort_order: number | null }[]
  const modifierIds = joins.map(j => j.modifier_id).filter(Boolean) as string[]
  if (modifierIds.length === 0) return []

  // Fetch modifier definitions
  const { data: modRows } = await supabase
    .from('modifiers')
    .select('id, system_lookup_name, display_name, modifier_type, units, range_min_value, range_max_value, range_default_value, range_step_interval, show_customer, show_internally')
    .in('id', modifierIds)
    .eq('active', true)

  const modMap = new Map<string, Record<string, unknown>>()
  for (const m of (modRows ?? []) as Record<string, unknown>[]) {
    modMap.set(m.id as string, m)
  }

  // Merge and filter — only show_internal
  const result: ModifierDef[] = []
  for (const j of joins) {
    if (!j.modifier_id) continue
    const m = modMap.get(j.modifier_id)
    if (!m) continue
    if (m.show_internally === false) continue

    result.push({
      id: m.id as string,
      system_lookup_name: (m.system_lookup_name as string) ?? '',
      display_name: (m.display_name as string) ?? '',
      modifier_type: (m.modifier_type as string) ?? 'Boolean',
      units: (m.units as string) ?? null,
      range_min_value: m.range_min_value != null ? Number(m.range_min_value) : null,
      range_max_value: m.range_max_value != null ? Number(m.range_max_value) : null,
      range_default_value: m.range_default_value != null ? Number(m.range_default_value) : null,
      range_step_interval: m.range_step_interval != null ? Number(m.range_step_interval) : null,
      show_customer: m.show_customer !== false,
      show_internal: m.show_internally !== false,
      default_value: (j.default_value as string) ?? null,
      is_required: j.is_required === true,
    })
  }

  return result
}
