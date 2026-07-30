import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAndOrg } from '@/lib/pricing-tiers-server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: materialId } = await context.params
  const { supabase, orgId } = await getSupabaseAndOrg()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('material_pricing_tiers')
    .select('from_qty, to_qty, cost, price')
    .eq('material_id', materialId)
    .eq('organization_id', orgId)
    .order('from_qty', { ascending: true })

  const rows = (data ?? []) as { from_qty: number; to_qty: number | null; cost: number; price: number }[]
  const headers = ['From Qty', 'To Qty', 'Cost', 'Price']
  const csv = [
    headers.join(','),
    ...rows.map((r) => [r.from_qty, r.to_qty ?? '', r.cost, r.price].join(',')),
  ].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=pricing-tiers.csv',
    },
  })
}
