import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Discount, DiscountTier } from '@/types/product-builder'
import DiscountsClient from './discounts-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function DiscountsPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  const { data: discounts } = await supabase
    .from('discounts')
    .select('*')
    .eq('organization_id', org.id)
    .order('name', { ascending: true }) as { data: Discount[] | null; error: unknown }

  const discountIds = (discounts ?? []).map((d) => d.id)
  const tiersByDiscount: Record<string, DiscountTier[]> = {}
  if (discountIds.length > 0) {
    const { data: tiers } = await supabase
      .from('discount_tiers')
      .select('*')
      .in('discount_id', discountIds)
      .order('sort_order', { ascending: true }) as { data: DiscountTier[] | null; error: unknown }

    for (const t of tiers ?? []) {
      if (!t.discount_id) continue
      if (!tiersByDiscount[t.discount_id]) tiersByDiscount[t.discount_id] = []
      tiersByDiscount[t.discount_id].push(t)
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
          <span className="text-gray-700">Discounts</span>
        </div>
      </div>

      <DiscountsClient
        orgId={org.id}
        orgSlug={slug}
        initialDiscounts={discounts ?? []}
        tiersByDiscount={tiersByDiscount}
      />
    </div>
  )
}
