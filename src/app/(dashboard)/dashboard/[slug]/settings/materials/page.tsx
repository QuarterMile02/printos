import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import MaterialsFilter from './materials-filter'

export const dynamic = 'force-dynamic'

type StockStatus = 'ok' | 'low' | 'out'

function stockStatus(cur: number | null, min: number | null): StockStatus {
  const c = Number(cur ?? 0)
  const m = Number(min ?? 0)
  if (m <= 0) return 'ok'
  if (c <= 0) return 'out'
  if (c < m)  return 'low'
  return 'ok'
}

const STATUS_BADGE: Record<StockStatus, string> = {
  ok:  'bg-green-50 text-green-700',
  low: 'bg-amber-50 text-amber-700',
  out: 'bg-red-50  text-red-700',
}
const STATUS_LABEL: Record<StockStatus, string> = {
  ok: 'OK', low: 'Low', out: 'Out',
}

export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ search?: string; low_stock?: string; type?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const search   = sp.search?.trim().toLowerCase() ?? ''
  const lowOnly  = sp.low_stock === '1'
  const typeFilter = sp.type?.trim() ?? ''
  const supabase = await createClient()

  const { data: orgRow } = await supabase
    .from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  type MatRow = {
    id: string; name: string
    cost: number | null; price: number | null; multiplier: number | null
    formula: string | null; selling_units: string | null
    active: boolean | null; material_type_id: string | null
    material_type: string | null; material_category: string | null
    current_stock: number | null; min_stock_level: number | null
  }

  const [rowsRes, countRes] = await Promise.all([
    supabase
      .from('materials')
      .select('id, name, cost, price, multiplier, formula, selling_units, active, material_type_id, material_type, material_category, current_stock, min_stock_level')
      .eq('organization_id', org.id)
      .order('name')
      .limit(1000),
    supabase
      .from('materials')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])
  const totalCount = countRes.count ?? 0
  let materials = (rowsRes.data ?? []) as MatRow[]

  // Resolve legacy FK type names for any rows missing the new text column
  const legacyTypeIds = [...new Set(
    materials.filter(m => !m.material_type && m.material_type_id).map(m => m.material_type_id) as string[]
  )]
  const typeMap = new Map<string, string>()
  if (legacyTypeIds.length > 0) {
    const { data: types } = await supabase
      .from('material_types').select('id, name').in('id', legacyTypeIds)
    for (const t of (types ?? []) as { id: string; name: string }[]) typeMap.set(t.id, t.name)
  }
  const resolveType = (m: MatRow): string =>
    m.material_type ?? (m.material_type_id ? typeMap.get(m.material_type_id) ?? '—' : '—')

  // Distinct types for the filter dropdown
  const typeSet = new Set<string>()
  for (const m of materials) {
    const t = resolveType(m)
    if (t && t !== '—') typeSet.add(t)
  }
  const distinctTypes = [...typeSet].sort((a, b) => a.localeCompare(b))

  const lowCount = materials.filter(m => {
    const st = stockStatus(m.current_stock, m.min_stock_level)
    return st === 'low' || st === 'out'
  }).length

  if (search)  materials = materials.filter(m => m.name.toLowerCase().includes(search))
  if (typeFilter) materials = materials.filter(m => resolveType(m) === typeFilter)
  if (lowOnly) materials = materials.filter(m => {
    const st = stockStatus(m.current_stock, m.min_stock_level)
    return st === 'low' || st === 'out'
  })

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Materials</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">
          Materials <span className="text-sm font-normal text-gray-400">({totalCount})</span>
          {lowCount > 0 && !lowOnly && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              {lowCount} low/out
            </span>
          )}
        </h1>
        <div className="flex gap-2">
          <a href={`/api/export/materials?orgId=${org.id}`} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Export CSV</a>
          <Link href={`/dashboard/${slug}/settings/materials/import`} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Import CSV</Link>
          <Link href={`/dashboard/${slug}/settings/materials/new`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">+ New Material</Link>
        </div>
      </div>

      <MaterialsFilter
        search={search}
        lowOnly={lowOnly}
        lowCount={lowCount}
        typeFilter={typeFilter}
        distinctTypes={distinctTypes}
        basePath={`/dashboard/${slug}/settings/materials`}
      />

      {totalCount > 1000 && (
        <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Showing 1000 of {totalCount} — use search to filter
        </p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Category</th>
              <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Cost</th>
              <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price</th>
              <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Multiplier</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
              <th className="px-5 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
              <th className="px-5 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {materials.length === 0 ? (
              <tr><td colSpan={9} className="px-6 py-8 text-center text-sm text-gray-400">
                {lowOnly ? 'No low-stock materials — inventory looks good.' : `No materials${search ? ` matching "${search}"` : ''}.`}
              </td></tr>
            ) : materials.map((m) => {
              const st = stockStatus(m.current_stock, m.min_stock_level)
              return (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link href={`/dashboard/${slug}/settings/materials/${m.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{m.name}</Link>
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-600">{resolveType(m)}</td>
                  <td className="px-5 py-3 text-sm text-gray-600">{m.material_category ?? '—'}</td>
                  <td className="px-5 py-3 text-sm text-gray-900 text-right tabular-nums">${Number(m.cost ?? 0).toFixed(4)}</td>
                  <td className="px-5 py-3 text-sm text-gray-900 text-right tabular-nums">${Number(m.price ?? 0).toFixed(4)}</td>
                  <td className="px-5 py-3 text-sm text-gray-600 text-right tabular-nums">{Number(m.multiplier ?? 1).toFixed(2)}x</td>
                  <td className="px-5 py-3 text-sm text-gray-600">{m.formula ?? '—'}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_BADGE[st]}`}>
                      {STATUS_LABEL[st]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${m.active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
