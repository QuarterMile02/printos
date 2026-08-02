import { NextRequest, NextResponse } from 'next/server'
import { validateTierShape, checkNoOverlap } from '@/lib/pricing-tiers'
import { getSupabaseAndOrg, materialBelongsToOrg } from '@/lib/pricing-tiers-server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: materialId } = await context.params
  const { supabase, orgId } = await getSupabaseAndOrg()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('material_pricing_tiers')
    .select('id, material_id, from_qty, to_qty, cost, price, created_at, updated_at')
    .eq('material_id', materialId)
    .eq('organization_id', orgId)
    .order('from_qty', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: materialId } = await context.params
  const { supabase, orgId } = await getSupabaseAndOrg()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ownsMaterial = await materialBelongsToOrg(supabase, materialId, orgId)
  if (!ownsMaterial) return NextResponse.json({ error: 'Material not found' }, { status: 404 })

  const body = await request.json()
  const shapeError = validateTierShape(body)
  if (shapeError) return NextResponse.json({ error: shapeError }, { status: 400 })

  const from_qty = Number(body.from_qty)
  const to_qty = body.to_qty === null || body.to_qty === undefined || body.to_qty === '' ? null : Number(body.to_qty)
  const cost = Number(body.cost)
  const price = Number(body.price)

  const { data: existing, error: existingError } = await supabase
    .from('material_pricing_tiers')
    .select('from_qty, to_qty')
    .eq('material_id', materialId)
    .eq('organization_id', orgId)
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })

  const overlapError = checkNoOverlap({ from_qty, to_qty }, existing as { from_qty: number; to_qty: number | null }[])
  if (overlapError) return NextResponse.json({ error: overlapError }, { status: 400 })

  const { data, error } = await supabase
    .from('material_pricing_tiers')
    .insert({
      organization_id: orgId,
      material_id: materialId,
      from_qty,
      to_qty,
      cost,
      price,
    })
    .select('id, material_id, from_qty, to_qty, cost, price, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
