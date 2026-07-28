import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single()
  if (!profile) return NextResponse.json([], { status: 200 })

  let query = supabase
    .from('materials')
    .select('id, name, cost, buying_units, selling_units, po_description, sell_buy_ratio, sheet_cost')
    .eq('organization_id', profile.organization_id)
    .eq('active', true)
    .order('name')
    .limit(20)

  if (search.trim()) {
    query = query.ilike('name', `%${search.trim()}%`)
  }

  const { data } = await query

  // A PO buys by buying_units (e.g. per Sheet), but materials.cost is
  // priced per selling_units (e.g. per Sqft) — the unit used for
  // quoting jobs. sheet_cost is the stored buying-unit price and is
  // preferred when present; cost * sell_buy_ratio is the fallback
  // derivation for materials where it's missing.
  const withBuyUnitCost = (data ?? []).map((m) => ({
    ...m,
    buy_unit_cost: m.sheet_cost ?? (m.sell_buy_ratio ? m.cost * m.sell_buy_ratio : null) ?? m.cost,
  }))

  return NextResponse.json(withBuyUnitCost)
}
