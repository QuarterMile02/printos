import { NextRequest, NextResponse } from 'next/server'
import { validateTierShape, checkNoOverlap, type TierRange } from '@/lib/pricing-tiers'
import { getSupabaseAndOrg, materialBelongsToOrg } from '@/lib/pricing-tiers-server'

export const dynamic = 'force-dynamic'

// Replaces ALL existing pricing tiers for this material with the given
// rows. Used by the "Import Tiers CSV" button — the client is
// responsible for confirming the replace with the user beforehand.
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
  const rows = Array.isArray(body.rows) ? body.rows : null
  if (!rows) return NextResponse.json({ error: 'rows must be an array' }, { status: 400 })
  if (rows.length === 0) return NextResponse.json({ error: 'No rows to import' }, { status: 400 })

  const parsed: TierRange[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const shapeError = validateTierShape(row)
    if (shapeError) return NextResponse.json({ error: `Row ${i + 1}: ${shapeError}` }, { status: 400 })
    const from_qty = Number(row.from_qty)
    const to_qty = row.to_qty === null || row.to_qty === undefined || row.to_qty === '' ? null : Number(row.to_qty)
    const overlapError = checkNoOverlap({ from_qty, to_qty }, parsed)
    if (overlapError) return NextResponse.json({ error: `Row ${i + 1}: ${overlapError}` }, { status: 400 })
    parsed.push({ from_qty, to_qty })
  }

  const { error: deleteError } = await supabase
    .from('material_pricing_tiers')
    .delete()
    .eq('material_id', materialId)
    .eq('organization_id', orgId)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  const { data, error: insertError } = await supabase
    .from('material_pricing_tiers')
    .insert(
      rows.map((row: { from_qty: unknown; to_qty: unknown; cost: unknown; price: unknown }) => ({
        organization_id: orgId,
        material_id: materialId,
        from_qty: Number(row.from_qty),
        to_qty: row.to_qty === null || row.to_qty === undefined || row.to_qty === '' ? null : Number(row.to_qty),
        cost: Number(row.cost),
        price: Number(row.price),
      })),
    )
    .select('id, material_id, from_qty, to_qty, cost, price, created_at, updated_at')

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const sorted = (data ?? []).sort((a, b) => a.from_qty - b.from_qty)
  return NextResponse.json(sorted)
}
