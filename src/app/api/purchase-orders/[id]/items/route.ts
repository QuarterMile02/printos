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
  const { description, quantity, unit_cost, sort_order } = body

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
      unit_cost: cost,
      total_cost,
      sort_order: sort_order ?? 0,
    })
    .select('id, description, quantity, unit_cost, total_cost, received_qty, sort_order')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: items } = await supabase
    .from('purchase_order_items')
    .select('total_cost')
    .eq('po_id', poId)

  const subtotal = (items ?? []).reduce((s, i) => s + Number(i.total_cost ?? 0), 0)
  await supabase.from('purchase_orders').update({ subtotal, total: subtotal }).eq('id', poId)

  return NextResponse.json(data, { status: 201 })
}
