import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const productId = request.nextUrl.searchParams.get('productId')
  const orgId = request.nextUrl.searchParams.get('orgId')
  if (!productId || !orgId) {
    return NextResponse.json([])
  }

  const service = createServiceClient()

  // Get product_modifiers join rows
  const { data: pmRows } = await service
    .from('product_modifiers')
    .select('modifier_id, default_value, is_required, sort_order')
    .eq('product_id', productId)
    .eq('organization_id', orgId)
    .order('sort_order')

  const joins = (pmRows ?? []) as { modifier_id: string | null; default_value: string | null; is_required: boolean | null }[]
  const modifierIds = joins.map(j => j.modifier_id).filter(Boolean) as string[]
  if (modifierIds.length === 0) {
    return NextResponse.json([])
  }

  // Fetch modifier definitions
  const { data: modRows } = await service
    .from('modifiers')
    .select('id, system_lookup_name, display_name, modifier_type, units, range_min_value, range_max_value, range_default_value, range_step_interval, show_customer, show_internally')
    .in('id', modifierIds)
    .eq('active', true)

  const modMap = new Map<string, Record<string, unknown>>()
  for (const m of (modRows ?? []) as Record<string, unknown>[]) {
    modMap.set(m.id as string, m)
  }

  const result = []
  for (const j of joins) {
    if (!j.modifier_id) continue
    const m = modMap.get(j.modifier_id)
    if (!m) continue
    if (m.show_internally === false) continue

    result.push({
      id: m.id,
      system_lookup_name: m.system_lookup_name ?? '',
      display_name: m.display_name ?? '',
      modifier_type: m.modifier_type ?? 'Boolean',
      units: m.units ?? null,
      range_min_value: m.range_min_value != null ? Number(m.range_min_value) : null,
      range_max_value: m.range_max_value != null ? Number(m.range_max_value) : null,
      range_default_value: m.range_default_value != null ? Number(m.range_default_value) : null,
      range_step_interval: m.range_step_interval != null ? Number(m.range_step_interval) : null,
      show_customer: m.show_customer !== false,
      show_internal: m.show_internally !== false,
      default_value: j.default_value ?? null,
      is_required: j.is_required === true,
    })
  }

  return NextResponse.json(result)
}
