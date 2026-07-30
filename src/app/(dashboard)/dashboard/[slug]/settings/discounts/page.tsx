import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const TYPES = ['Range', 'Volume', 'Price']
const APPLIES_TO = ['Product', 'Material', 'Both']

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ search?: string; type?: string; applies_to?: string; status?: string; sort?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const sortDesc = sp.sort === 'desc'
  const search = sp.search?.trim().toLowerCase() ?? ''
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const [rowsRes, countRes] = await Promise.all([
    supabase
      .from('discounts')
      .select('id, name, discount_type, applies_to, discount_by, active')
      .eq('organization_id', org.id)
      .order('name', { ascending: !sortDesc })
      .limit(1000),
    supabase
      .from('discounts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])
  const totalCount = countRes.count ?? 0
  let discounts = (rowsRes.data ?? []) as { id: string; name: string; discount_type: string | null; applies_to: string | null; discount_by: string | null; active: boolean | null }[]

  if (search) discounts = discounts.filter(d => d.name.toLowerCase().includes(search))
  if (sp.type) discounts = discounts.filter(d => d.discount_type === sp.type)
  if (sp.applies_to) discounts = discounts.filter(d => d.applies_to === sp.applies_to)
  if (sp.status === 'active') discounts = discounts.filter(d => d.active !== false)
  if (sp.status === 'inactive') discounts = discounts.filter(d => d.active === false)

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

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold text-qm-black">Discounts <span className="text-sm font-normal text-gray-400">({totalCount})</span></h1>
        <div className="flex items-center gap-2">
          {(() => {
            const p = new URLSearchParams()
            if (sp.search) p.set('search', sp.search)
            if (sp.type) p.set('type', sp.type)
            if (sp.applies_to) p.set('applies_to', sp.applies_to)
            if (sp.status) p.set('status', sp.status)
            if (!sortDesc) p.set('sort', 'desc')
            return (
              <Link
                href={`/dashboard/${slug}/settings/discounts?${p}`}
                className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
              >
                {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
              </Link>
            )
          })()}
          <Link href={`/dashboard/${slug}/settings/discounts/new`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
            + New Discount
          </Link>
        </div>
      </div>

      <form className="mb-4 flex flex-wrap gap-3">
        {sortDesc && <input type="hidden" name="sort" value="desc" />}
        <input type="text" name="search" defaultValue={sp.search ?? ''} placeholder="Search by name..." className="rounded-md border border-gray-300 px-3 py-2 text-sm w-64 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
        <select name="type" defaultValue={sp.type ?? ''} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select name="applies_to" defaultValue={sp.applies_to ?? ''} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">
          <option value="">All Applies To</option>
          {APPLIES_TO.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">Filter</button>
      </form>

      {totalCount > 1000 && (
        <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Showing 1000 of {totalCount} — use search to filter
        </p>
      )}

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
              <tr><td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-400">
                No discounts{search ? ` matching "${search}"` : ''}.
              </td></tr>
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
