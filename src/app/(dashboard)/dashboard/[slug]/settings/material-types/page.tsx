import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveMaterialType, deleteMaterialType } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'

export const dynamic = 'force-dynamic'

type MaterialType = {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; sort?: string; search?: string; status?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[material-types] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (material-types)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const sortDesc = sp.sort === 'desc'
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { allowed } = await checkPermission(org.id, 'settings.material_types')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Material Types</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to manage material types. Contact your organization owner.
        </div>
      </div>
    )
  }

  const { data: typesData } = await supabase
    .from('material_types')
    .select('id, name, is_active, created_at')
    .eq('organization_id', org.id)
    .order('name', { ascending: !sortDesc })

  const allTypes = (typesData ?? []) as MaterialType[]
  const search = (sp.search ?? '').trim().toLowerCase()
  const statusFilter = sp.status ?? ''
  let types = allTypes
  if (search) types = types.filter(t => t.name.toLowerCase().includes(search))
  if (statusFilter === 'active') types = types.filter(t => t.is_active !== false)
  if (statusFilter === 'inactive') types = types.filter(t => t.is_active === false)

  const editId = sp.edit
  const showAdd = sp.add === '1'
  const editType = editId ? allTypes.find(t => t.id === editId) ?? null : null
  const isPanelOpen = Boolean(editType || showAdd)

  // Usage counts — only allow delete when count = 0
  const usageCounts: Record<string, number> = {}
  if (allTypes.length > 0) {
    const { data: usageData } = await supabase
      .from('materials')
      .select('material_type_id')
      .eq('organization_id', org.id)
      .not('material_type_id', 'is', null)
    for (const r of (usageData ?? []) as { material_type_id: string }[]) {
      usageCounts[r.material_type_id] = (usageCounts[r.material_type_id] ?? 0) + 1
    }
  }

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  function buildUrl(overrides: { sort?: string; add?: string } = {}) {
    const p = new URLSearchParams()
    const sort = 'sort' in overrides ? overrides.sort : (sortDesc ? 'desc' : '')
    if (sort) p.set('sort', sort)
    if (sp.search) p.set('search', sp.search)
    if (statusFilter) p.set('status', statusFilter)
    if (overrides.add) p.set('add', overrides.add)
    const qs = p.toString()
    return `/dashboard/${slug}/settings/material-types${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Material Types</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-qm-black">
          Material Types <span className="text-sm font-normal text-gray-400">({types.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={buildUrl({ sort: sortDesc ? '' : 'desc' })}
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
          </Link>
          <Link
            href={buildUrl({ add: '1' })}
            className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            + New Type
          </Link>
        </div>
      </div>

      {/* Search + status filter */}
      <form className="mb-4 flex flex-wrap gap-3">
        {sortDesc && <input type="hidden" name="sort" value="desc" />}
        <input
          type="text"
          name="search"
          defaultValue={sp.search ?? ''}
          placeholder="Search by name..."
          className="block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
        <select
          name="status"
          defaultValue={statusFilter}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
          Filter
        </button>
      </form>

      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">
            {editType ? 'Edit Material Type' : 'New Material Type'}
          </h2>
          <form action={saveMaterialType} className="space-y-4">
            {editType && <input type="hidden" name="id" value={editType.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />

            <div>
              <label className={labelCls}>Name *</label>
              <input type="text" name="name" required defaultValue={editType?.name ?? ''} className={inputCls} />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={editType?.is_active !== false}
                className="h-4 w-4 accent-qm-lime"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
                Save
              </button>
              <Link
                href={`/dashboard/${slug}/settings/material-types`}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Materials</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className={`px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500 ${STICKY_ACTIONS_TH}`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {types.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                  {search || statusFilter ? 'No material types match the current filters.' : 'No material types yet. Add your first type above.'}
                </td>
              </tr>
            ) : types.map(t => {
              const inUse = (usageCounts[t.id] ?? 0) > 0
              return (
                <tr key={t.id} className="group hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/${slug}/settings/material-types?edit=${t.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia"
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 text-right tabular-nums">
                    {usageCounts[t.id] ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${t.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className={`px-4 py-3 text-right ${STICKY_ACTIONS_TD}`}>
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/dashboard/${slug}/settings/material-types?edit=${t.id}`}
                        className="text-sm text-qm-lime hover:underline"
                      >
                        Edit
                      </Link>
                      {!inUse && (
                        <form action={deleteMaterialType} className="inline">
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="orgSlug" value={slug} />
                          <button type="submit" className="text-sm text-red-500 hover:underline">
                            Delete
                          </button>
                        </form>
                      )}
                      {inUse && (
                        <span className="text-xs text-gray-400">In use</span>
                      )}
                    </div>
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
