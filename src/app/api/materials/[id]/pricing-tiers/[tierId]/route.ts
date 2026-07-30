import { NextRequest, NextResponse } from 'next/server'
import { validateTierShape, checkNoOverlap } from '@/lib/pricing-tiers'
import { getSupabaseAndOrg } from '@/lib/pricing-tiers-server'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; tierId: string }> },
) {
  const { id: materialId, tierId } = await context.params
  const { supabase, orgId } = await getSupabaseAndOrg()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const shapeError = validateTierShape(body)
  if (shapeError) return NextResponse.json({ error: shapeError }, { status: 400 })

  const from_qty = Number(body.from_qty)
  const to_qty = body.to_qty === null || body.to_qty === undefined || body.to_qty === '' ? null : Number(body.to_qty)
  const cost = Number(body.cost)
  const price = Number(body.price)

  const { data: existing } = await supabase
    .from('material_pricing_tiers')
    .select('id, from_qty, to_qty')
    .eq('material_id', materialId)
    .eq('organization_id', orgId)

  const others = ((existing ?? []) as { id: string; from_qty: number; to_qty: number | null }[])
    .filter((t) => t.id !== tierId)
  const overlapError = checkNoOverlap({ from_qty, to_qty }, others)
  if (overlapError) return NextResponse.json({ error: overlapError }, { status: 400 })

  const { data, error } = await supabase
    .from('material_pricing_tiers')
    .update({
      from_qty,
      to_qty,
      cost,
      price,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tierId)
    .eq('material_id', materialId)
    .eq('organization_id', orgId)
    .select('id, material_id, from_qty, to_qty, cost, price, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; tierId: string }> },
) {
  const { id: materialId, tierId } = await context.params
  const { supabase, orgId } = await getSupabaseAndOrg()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('material_pricing_tiers')
    .delete()
    .eq('id', tierId)
    .eq('material_id', materialId)
    .eq('organization_id', orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return new NextResponse(null, { status: 204 })
}
