import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { LaborRate, Discount, MachineRate } from '@/types/product-builder'
import LaborRatesClient from './labor-rates-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function LaborRatesPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // Fetch org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  // Fetch labor rates (full records — form needs everything)
  const { data: laborRates } = await supabase
    .from('labor_rates')
    .select('*')
    .eq('organization_id', org.id)
    .order('name', { ascending: true }) as { data: LaborRate[] | null; error: unknown }

  // Fetch discounts for the volume discount dropdown
  const { data: discounts } = await supabase
    .from('discounts')
    .select('id, name, discount_type, applies_to, discount_by, active')
    .eq('organization_id', org.id)
    .order('name') as { data: Pick<Discount, 'id' | 'name' | 'discount_type' | 'applies_to' | 'discount_by' | 'active'>[] | null; error: unknown }

  // Fetch machine rates for the "Clone from" picker
  const { data: machineRates } = await supabase
    .from('machine_rates')
    .select('id, name, cost, price, markup, units, formula, active')
    .eq('organization_id', org.id)
    .order('name') as { data: Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'markup' | 'units' | 'formula' | 'active'>[] | null; error: unknown }

  // Fetch product_default_items → products map for "Used In" section
  type UsedInRow = {
    labor_rate_id: string | null
    product: { id: string; name: string } | null
  }
  const { data: defaultItems } = await supabase
    .from('product_default_items')
    .select('labor_rate_id, product:products(id, name)')
    .eq('organization_id', org.id)
    .not('labor_rate_id', 'is', null) as { data: UsedInRow[] | null; error: unknown }

  const usedInMap: Record<string, { id: string; name: string }[]> = {}
  for (const item of defaultItems ?? []) {
    if (!item.labor_rate_id || !item.product) continue
    if (!usedInMap[item.labor_rate_id]) usedInMap[item.labor_rate_id] = []
    // Dedupe
    if (!usedInMap[item.labor_rate_id].some((p) => p.id === item.product!.id)) {
      usedInMap[item.labor_rate_id].push(item.product)
    }
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-500">Settings</span>
          <span>/</span>
          <span className="text-gray-700">Labor Rates</span>
        </div>
      </div>

      <LaborRatesClient
        orgId={org.id}
        orgSlug={slug}
        initialLaborRates={laborRates ?? []}
        discounts={discounts ?? []}
        machineRates={machineRates ?? []}
        usedInMap={usedInMap}
      />
    </div>
  )
}
