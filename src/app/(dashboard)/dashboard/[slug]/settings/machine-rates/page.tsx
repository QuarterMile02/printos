import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { MachineRate, Discount } from '@/types/product-builder'
import MachineRatesClient from './machine-rates-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function MachineRatesPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  const { data: machineRates } = await supabase
    .from('machine_rates')
    .select('*')
    .eq('organization_id', org.id)
    .order('name', { ascending: true }) as { data: MachineRate[] | null; error: unknown }

  const { data: discounts } = await supabase
    .from('discounts')
    .select('id, name, discount_type, applies_to, discount_by, active')
    .eq('organization_id', org.id)
    .order('name') as { data: Pick<Discount, 'id' | 'name' | 'discount_type' | 'applies_to' | 'discount_by' | 'active'>[] | null; error: unknown }

  // Used In: products referencing this machine rate via product_default_items
  type UsedInRow = {
    machine_rate_id: string | null
    product: { id: string; name: string } | null
  }
  const { data: defaultItems } = await supabase
    .from('product_default_items')
    .select('machine_rate_id, product:products(id, name)')
    .eq('organization_id', org.id)
    .not('machine_rate_id', 'is', null) as { data: UsedInRow[] | null; error: unknown }

  const usedInMap: Record<string, { id: string; name: string }[]> = {}
  for (const item of defaultItems ?? []) {
    if (!item.machine_rate_id || !item.product) continue
    if (!usedInMap[item.machine_rate_id]) usedInMap[item.machine_rate_id] = []
    if (!usedInMap[item.machine_rate_id].some((p) => p.id === item.product!.id)) {
      usedInMap[item.machine_rate_id].push(item.product)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-500">Settings</span>
          <span>/</span>
          <span className="text-gray-700">Machine Rates</span>
        </div>
      </div>

      <MachineRatesClient
        orgId={org.id}
        orgSlug={slug}
        initialMachineRates={machineRates ?? []}
        discounts={discounts ?? []}
        usedInMap={usedInMap}
      />
    </div>
  )
}
