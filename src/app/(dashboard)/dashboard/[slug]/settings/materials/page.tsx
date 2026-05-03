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
  searchParams: Promise<{ search?: string; low_stock?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const search  = sp.search?.trim().toLowerCase() ?? ''
  const lowOnly = sp.low_stock === '1'
  const supabase = await createClient()

  const { data: orgRow } = await supabase
    .from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  type MatRow = {
    id: string; name: string
    cost: number | null; price: number | null; selling_units: string | null
    active: boolean | null; material_type_id: string | null
    current_stock: number | null; min_stock_level: number | null
  }

  const { data: rows } = await supabase
    .from('materials')
    .select('id, name, cost, price, selling_units, active, material_type_id, current_stock, min_stock_level')
    .eq('organization_id', org.id)
    .order('name')
  let materials = (rows ?? []) as MatRow[]

  // Resolve type names
  const typeIds = [...new Set(materials.map(m => m.material_type_id).filter(Boolean) as string[])]
  const typeMap = new Map<string, string>()
  if (typeIds.length > 0) {
    const { data: types } = await supabase
      .from('material_types').select('id, name').in('id', typeIds)
    for (const t of (types ?? []) as { id: string; name: string }[]) typeMap.set(t.id, t.name)
  }

  const lowCount = materials.filter(m => {
    const st = stockStatus(m.current_stock, m.min_stock_level)
    return st === 'low' || st === 'out'
  }).length

  if (search)  materials = materials.filter(m => m.name.toLowerCase().includes(search))
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
          Materials <span className="text-sm font-normal text-gray-400">({materials.length})</span>
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

      {/* Client component owns all event handlers — fixes server/client boundary violation */}
      <MaterialsFilter
        search={search}
        lowOnly={lowOnly}
        lowCount={lowCount}
        basePath={`/dashboard/${slug}/settings/materials`}
      />

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
              <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Cost</th>
              <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price</th>
              <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Units</th>
              <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">In Stock</th>
              <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Min Level</th>
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
                  <td className="px-5 py-3 text-sm text-gray-600">
                    {m.material_type_id ? typeMap.get(m.material_type_id) ?? '—' : '—'}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-900 text-right tabular-nums">${Number(m.cost ?? 0).toFixed(4)}</td>
                  <td className="px-5 py-3 text-sm text-gray-900 text-right tabular-nums">${Number(m.price ?? 0).toFixed(4)}</td>
                  <td className="px-5 py-3 text-sm text-gray-600">{m.selling_units ?? '—'}</td>
                  <td className="px-5 py-3 text-sm text-gray-900 text-right tabular-nums">
                    {Number(m.current_stock ?? 0).toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-sm text-gray-500 text-right tabular-nums">
                    {Number(m.min_stock_level ?? 0).toFixed(2)}
                  </td>
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
