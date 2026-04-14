import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveDiscount, deleteDiscount } from '../actions-sr'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const isNew = id === 'new'
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  type Discount = { id: string; name: string; discount_type: string | null; applies_to: string | null; discount_by: string | null; active: boolean | null }
  type Tier = { id: string; min_qty: number; max_qty: number; discount_percent: number; sort_order: number }

  let discount: Discount | null = null
  let tiers: Tier[] = []

  if (!isNew) {
    const { data: d } = await supabase.from('discounts').select('id, name, discount_type, applies_to, discount_by, active').eq('id', id).eq('organization_id', org.id).single()
    discount = d as unknown as Discount | null
    if (!discount) return <div className="p-8 text-red-600">Discount not found</div>

    const { data: t } = await supabase.from('discount_tiers').select('id, min_qty, max_qty, discount_percent, sort_order').eq('discount_id', id).order('sort_order')
    tiers = (t ?? []) as Tier[]
  }

  // For new discounts, start with one empty tier
  if (isNew) tiers = [{ id: 'new-0', min_qty: 0, max_qty: 0, discount_percent: 0, sort_order: 1 }]

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/settings/discounts`} className="hover:text-gray-700">Discounts</Link>
        <span>/</span>
        <span className="text-gray-700">{isNew ? 'New' : discount?.name}</span>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold text-gray-900 mb-6">{isNew ? 'New Discount' : `Edit: ${discount?.name}`}</h1>

        <form action={saveDiscount} className="space-y-6">
          {!isNew && <input type="hidden" name="id" value={discount!.id} />}
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="orgSlug" value={slug} />
          <input type="hidden" name="tierCount" value={tiers.length} />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name *</label>
              <input type="text" name="name" required defaultValue={discount?.name ?? ''} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Type</label>
              <select name="discount_type" defaultValue={discount?.discount_type ?? 'Volume'} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
                <option value="Volume">Volume</option>
                <option value="Range">Range</option>
                <option value="Price">Price</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Applies To</label>
              <select name="applies_to" defaultValue={discount?.applies_to ?? 'Product'} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
                <option value="Product">Product</option>
                <option value="Material">Material</option>
                <option value="Both">Both</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Discount By</label>
              <select name="discount_by" defaultValue={discount?.discount_by ?? 'Percentage'} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime">
                <option value="Percentage">Percentage</option>
                <option value="Fixed Price">Fixed Price</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" name="active" defaultChecked={discount?.active !== false} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
            Active
          </label>

          {/* Tiers */}
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">Discount Tiers</h2>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Min Qty</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Max Qty</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Discount %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tiers.map((tier, i) => (
                    <tr key={tier.id}>
                      <td className="px-4 py-2">
                        <input type="number" name={`tier_min_${i}`} step="0.01" defaultValue={Number(tier.min_qty)} className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" name={`tier_max_${i}`} step="0.01" defaultValue={Number(tier.max_qty)} className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" name={`tier_pct_${i}`} step="0.01" defaultValue={Number(tier.discount_percent)} className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-gray-400">To add or remove tiers, save and return to this page. Tiers are saved in order shown.</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">Save</button>
            <Link href={`/dashboard/${slug}/settings/discounts`} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</Link>
            {!isNew && (
              <form action={deleteDiscount} className="inline ml-auto">
                <input type="hidden" name="id" value={discount!.id} />
                <input type="hidden" name="orgSlug" value={slug} />
                <button type="submit" className="rounded-md border border-red-300 px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
              </form>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
