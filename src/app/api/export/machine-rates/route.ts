import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId')
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  const supabase = await createClient()
  const { data } = await supabase.from('machine_rates').select('name, external_name, cost, price, markup, units, formula, setup_charge, labor_charge, other_charge, production_rate, active').eq('organization_id', orgId).order('name')
  const rows = (data ?? []) as Record<string, unknown>[]

  const headers = ['Name', 'External Name', 'Cost', 'Price', 'Markup', 'Units', 'Formula', 'Setup Charge', 'Labor Charge', 'Other Charge', 'Production Rate', 'Active']
  const keys = ['name', 'external_name', 'cost', 'price', 'markup', 'units', 'formula', 'setup_charge', 'labor_charge', 'other_charge', 'production_rate', 'active']
  const csv = [headers.join(','), ...rows.map(r => keys.map(k => `"${String(r[k] ?? '')}"`).join(','))].join('\n')

  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=machine_rates.csv' } })
}
