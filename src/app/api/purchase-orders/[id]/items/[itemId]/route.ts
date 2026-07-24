import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id: poId, itemId } = await context.params
  const body = await request.json()
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const patch: Record<string, unknown> = {}
  if ('description' in body) patch.description = body.description
  if ('received_qty' in body) patch.received_qty = Number(body.received_qty)

  if ('quantity' in body || 'unit_cost' in body) {
    const { data: current } = await supabase
      .from('purchase_order_items')
      .select('quantity, unit_cost')
      .eq('id', itemId)
      .single()
    const qty = Number('quantity' in body ? body.quantity : current?.quantity ?? 1)
    const cost = Number('unit_cost' in body ? body.unit_cost : current?.unit_cost ?? 0)
    patch.quantity = qty
    patch.unit_cost = cost
    patch.total_cost = Math.round(qty * cost * 100) / 100
  }

  const { data, error } = await supabase
    .from('purchase_order_items')
    .update(patch)
    .eq('id', itemId)
    .select('id, description, quantity, unit_cost, total_cost, received_qty, sort_order')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('total_cost')
    .eq('po_id', poId)
  const subtotal = (items ?? []).reduce((s, i) => s + Number(i.total_cost ?? 0), 0)
  await supabase.from('purchase_orders').update({ subtotal, total: subtotal }).eq('id', poId)

  return NextResponse.json(data)
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id: poId, itemId } = await context.params
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase.from('purchase_order_items').delete().eq('id', itemId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('total_cost')
    .eq('po_id', poId)
  const subtotal = (items ?? []).reduce((s, i) => s + Number(i.total_cost ?? 0), 0)
  await supabase.from('purchase_orders').update({ subtotal, total: subtotal }).eq('id', poId)

  return new NextResponse(null, { status: 204 })
}
