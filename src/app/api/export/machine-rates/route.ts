import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { userBelongsToOrg } from '@/lib/require-org-access'

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId')
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  // Was relying on RLS alone with orgId taken straight off the query
  // string -- add a real auth check rather than trust that policy.
  if (!(await userBelongsToOrg(orgId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  const { data } = await supabase.from('machine_rates').select('name, external_name, cost, price, markup, units, formula, setup_charge, labor_charge, other_charge, production_rate, active').eq('organization_id', orgId).order('name')
  const rows = (data ?? []) as Record<string, unknown>[]

  const headers = ['Name', 'External Name', 'Cost', 'Price', 'Markup', 'Units', 'Formula', 'Setup Charge', 'Labor Charge', 'Other Charge', 'Production Rate', 'Active']
  const keys = ['name', 'external_name', 'cost', 'price', 'markup', 'units', 'formula', 'setup_charge', 'labor_charge', 'other_charge', 'production_rate', 'active']
  const csv = [headers.join(','), ...rows.map(r => keys.map(k => `"${String(r[k] ?? '')}"`).join(','))].join('\n')

  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=machine_rates.csv' } })
}
