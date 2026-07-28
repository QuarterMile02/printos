import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const orgId = searchParams.get('orgId')
  const status = searchParams.get('status')
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let query = supabase
    .from('purchase_orders')
    .select(`
      id, po_number, status, title, subtotal, tax_total, total,
      expected_delivery_date, received_date, created_at, updated_at,
      vendor:vendors(id, name),
      sales_order:sales_orders(id, so_number, title)
    `)
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { orgId, vendor_id, sales_order_id, title, notes, expected_delivery_date } = body
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('purchase_orders')
    .insert({
      organization_id: orgId,
      vendor_id: vendor_id ?? null,
      sales_order_id: sales_order_id ?? null,
      title: title ?? null,
      notes: notes ?? null,
      expected_delivery_date: expected_delivery_date ?? null,
      created_by: user.id,
    })
    .select('id, po_number, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
