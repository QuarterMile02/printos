import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: poId } = await context.params
  const body = await request.json()
  const { description, quantity, unit, unit_cost, sort_order, material_id } = body

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const qty = Number(quantity ?? 1)
  const cost = Number(unit_cost ?? 0)
  const total_cost = Math.round(qty * cost * 100) / 100

  const { data, error } = await supabase
    .from('purchase_order_items')
    .insert({
      po_id: poId,
      description: description ?? null,
      quantity: qty,
      unit: unit ?? null,
      unit_cost: cost,
      total_cost,
      sort_order: sort_order ?? 0,
      material_id: material_id ?? null,
    })
    .select('id, description, quantity, unit, unit_cost, total_cost, received_qty, sort_order, material_id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: items, error: itemsError } = await supabase
    .from('purchase_order_items')
    .select('total_cost')
    .eq('po_id', poId)
  if (itemsError) {
    console.error('[purchase-orders items POST] Failed to re-read items for total recompute:', itemsError.message, { poId })
    return NextResponse.json({ ...data, _warning: 'Item saved, but PO totals could not be recalculated.' }, { status: 201 })
  }

  const subtotal = items.reduce((s, i) => s + Number(i.total_cost ?? 0), 0)
  const { error: totalsError } = await supabase.from('purchase_orders').update({ subtotal, total: subtotal }).eq('id', poId)
  if (totalsError) {
    console.error('[purchase-orders items POST] Failed to update PO totals:', totalsError.message, { poId, subtotal })
    return NextResponse.json({ ...data, _warning: 'Item saved, but PO totals could not be recalculated.' }, { status: 201 })
  }

  return NextResponse.json(data, { status: 201 })
}
