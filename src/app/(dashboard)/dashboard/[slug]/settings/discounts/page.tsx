import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: rows } = await supabase
    .from('discounts')
    .select('id, name, discount_type, applies_to, discount_by, active')
    .eq('organization_id', org.id)
    .order('name')
  const discounts = (rows ?? []) as { id: string; name: string; discount_type: string | null; applies_to: string | null; discount_by: string | null; active: boolean | null }[]

  // Get tier counts
  const discountIds = discounts.map(d => d.id)
  const tierCounts = new Map<string, number>()
  if (discountIds.length > 0) {
    const { data: tiers } = await supabase.from('discount_tiers').select('discount_id').in('discount_id', discountIds)
    for (const t of (tiers ?? []) as { discount_id: string }[]) {
      tierCounts.set(t.discount_id, (tierCounts.get(t.discount_id) ?? 0) + 1)
    }
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Discounts</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Discounts <span className="text-sm font-normal text-gray-400">({discounts.length})</span></h1>
        <Link href={`/dashboard/${slug}/settings/discounts/new`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
          + New Discount
        </Link>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Applies To</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Tiers</th>
              <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {discounts.length === 0 ? (
              <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-400">No discounts yet.</td></tr>
            ) : discounts.map(d => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-6 py-3">
                  <Link href={`/dashboard/${slug}/settings/discounts/${d.id}`} className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{d.name}</Link>
                </td>
                <td className="px-6 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                    d.discount_type === 'Volume' ? 'bg-blue-50 text-blue-700' :
                    d.discount_type === 'Range' ? 'bg-amber-50 text-amber-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{d.discount_type ?? '—'}</span>
                </td>
                <td className="px-6 py-3 text-sm text-gray-600">{d.applies_to ?? '—'}</td>
                <td className="px-6 py-3 text-sm text-gray-900 text-right tabular-nums">{tierCounts.get(d.id) ?? 0}</td>
                <td className="px-6 py-3 text-center">
                  <span className={`inline-block h-2 w-2 rounded-full ${d.active !== false ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
