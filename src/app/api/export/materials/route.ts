import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get('orgId')
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  const supabase = await createClient()
  const { data } = await supabase.from('materials').select('name, external_name, cost, price, multiplier, buying_units, selling_units, formula, width, height, wastage_markup, labor_charge, machine_charge, setup_charge, preferred_vendor, active').eq('organization_id', orgId).order('name')
  const rows = (data ?? []) as Record<string, unknown>[]

  const headers = ['Name', 'External Name', 'Cost', 'Price', 'Multiplier', 'Buying Units', 'Selling Units', 'Formula', 'Width', 'Height', 'Wastage Markup', 'Labor Charge', 'Machine Charge', 'Setup Charge', 'Preferred Vendor', 'Active']
  const keys = ['name', 'external_name', 'cost', 'price', 'multiplier', 'buying_units', 'selling_units', 'formula', 'width', 'height', 'wastage_markup', 'labor_charge', 'machine_charge', 'setup_charge', 'preferred_vendor', 'active']
  const csv = [headers.join(','), ...rows.map(r => keys.map(k => `"${String(r[k] ?? '')}"`).join(','))].join('\n')

  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=materials.csv' } })
}
