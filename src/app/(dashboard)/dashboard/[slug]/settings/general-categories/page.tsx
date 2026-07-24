import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveGeneralCategory } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'

export const dynamic = 'force-dynamic'

const TYPES = [
  { value: 'asset', label: 'Asset' },
  { value: 'job',   label: 'Job'   },
  { value: 'quote', label: 'Quote' },
  { value: 'all',   label: 'All'   },
]

const SUBTYPES = [
  { value: 'asset',         label: 'Asset'         },
  { value: 'industry',      label: 'Industry'      },
  { value: 'lead_source',   label: 'Lead Source'   },
  { value: 'machine',       label: 'Machine'       },
  { value: 'note',          label: 'Note'          },
  { value: 'pricing_level', label: 'Pricing Level' },
  { value: 'tag',           label: 'Tag'           },
]

const SUBTABS = [
  { label: 'All',           value: '' },
  { label: 'Asset',         value: 'asset' },
  { label: 'Industry',      value: 'industry' },
  { label: 'Lead Source',   value: 'lead_source' },
  { label: 'Machine',       value: 'machine' },
  { label: 'Note',          value: 'note' },
  { label: 'Pricing Level', value: 'pricing_level' },
  { label: 'Tag',           value: 'tag' },
]

const TYPE_BADGE: Record<string, string> = {
  asset: 'bg-purple-50 text-purple-700',
  job:   'bg-amber-50  text-amber-700',
  quote: 'bg-blue-50   text-blue-700',
  all:   'bg-gray-100  text-gray-600',
}
const TYPE_LABEL: Record<string, string> = {
  asset: 'Asset',
  job:   'Job',
  quote: 'Quote',
  all:   'All',
}

const SUBTYPE_LABEL: Record<string, string> = {
  asset:         'Asset',
  industry:      'Industry',
  lead_source:   'Lead Source',
  machine:       'Machine',
  note:          'Note',
  pricing_level: 'Pricing Level',
  tag:           'Tag',
}

type Category = {
  id: string
  name: string
  type: string
  sub_type: string | null
  is_active: boolean
  created_at: string
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; type?: string; sub_type?: string; sort?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[general-categories] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (general-categories)</h1>
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
  const typeFilter = sp.type ?? ''
  const subTypeFilter = sp.sub_type ?? ''
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { allowed } = await checkPermission(org.id, 'settings.general_categories')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">General Categories</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to manage general categories. Contact your organization owner.
        </div>
      </div>
    )
  }

  // Fetch all — sub_type filtering is in-memory; type filter is server-side
  let query = supabase
    .from('general_categories')
    .select('id, name, type, sub_type, is_active, created_at')
    .eq('organization_id', org.id)
    .order('name', { ascending: !sortDesc })

  if (typeFilter) query = query.eq('type', typeFilter)

  const { data: allRes } = await query
  const allCategories = (allRes ?? []) as Category[]

  // In-memory sub_type filter
  const categories = subTypeFilter
    ? allCategories.filter(c => (c.sub_type ?? '') === subTypeFilter)
    : allCategories

  const editId = sp.edit
  const showAdd = sp.add === '1'

  let editCategory: Category | null = null
  if (editId) {
    editCategory = allCategories.find(c => c.id === editId) ?? null
    if (!editCategory) {
      const { data: found } = await supabase
        .from('general_categories')
        .select('id, name, type, sub_type, is_active, created_at')
        .eq('id', editId)
        .eq('organization_id', org.id)
        .single()
      editCategory = (found as Category | null)
    }
  }

  const isPanelOpen = Boolean(editCategory || showAdd)

  // Helper: build URL preserving all active params
  function buildUrl(overrides: { sub_type?: string; type?: string; add?: string; edit?: string; saved?: string } = {}) {
    const p = new URLSearchParams()
    if (sortDesc) p.set('sort', 'desc')
    const st = 'sub_type' in overrides ? overrides.sub_type : subTypeFilter
    if (st) p.set('sub_type', st)
    const t = 'type' in overrides ? overrides.type : typeFilter
    if (t) p.set('type', t)
    if (overrides.add)   p.set('add', overrides.add)
    if (overrides.edit)  p.set('edit', overrides.edit)
    if (overrides.saved) p.set('saved', overrides.saved)
    const qs = p.toString()
    return `/dashboard/${slug}/settings/general-categories${qs ? `?${qs}` : ''}`
  }

  const sortToggleUrl = (() => {
    const p = new URLSearchParams()
    if (subTypeFilter) p.set('sub_type', subTypeFilter)
    if (typeFilter) p.set('type', typeFilter)
    if (!sortDesc) p.set('sort', 'desc')
    const qs = p.toString()
    return `/dashboard/${slug}/settings/general-categories${qs ? `?${qs}` : ''}`
  })()

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">General Categories</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">
          General Categories <span className="text-sm font-normal text-gray-400">({categories.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={sortToggleUrl}
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
          </Link>
          <Link
            href={buildUrl({ add: '1' })}
            className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            + New Category
          </Link>
        </div>
      </div>

      {/* Sub-type tab bar */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
        {SUBTABS.map((tab) => {
          const isActive = subTypeFilter === tab.value
          const tabParams = new URLSearchParams()
          if (sortDesc) tabParams.set('sort', 'desc')
          if (typeFilter) tabParams.set('type', typeFilter)
          if (tab.value) tabParams.set('sub_type', tab.value)
          const qs = tabParams.toString()
          return (
            <Link
              key={tab.value}
              href={`/dashboard/${slug}/settings/general-categories${qs ? `?${qs}` : ''}`}
              className={`rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Existing type filter */}
      <form className="mb-4 flex flex-wrap gap-2">
        {sortDesc && <input type="hidden" name="sort" value="desc" />}
        {subTypeFilter && <input type="hidden" name="sub_type" value={subTypeFilter} />}
        <select
          name="type"
          defaultValue={typeFilter}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="">All Applies-To Types</option>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
          Filter
        </button>
        {typeFilter && (
          <Link
            href={buildUrl({ type: '' })}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Inline panel */}
      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">
            {editCategory ? 'Edit Category' : 'New General Category'}
          </h2>
          <form action={saveGeneralCategory} className="space-y-4">
            {editCategory && <input type="hidden" name="id" value={editCategory.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />
            <input type="hidden" name="returnSubType" value={subTypeFilter} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Name *</label>
                <input type="text" name="name" required defaultValue={editCategory?.name ?? ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Applies To *</label>
                <select name="type" required defaultValue={editCategory?.type ?? 'all'} className={inputCls}>
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Sub-Type</label>
                <select name="sub_type" defaultValue={editCategory?.sub_type ?? subTypeFilter} className={inputCls}>
                  <option value="">— None —</option>
                  {SUBTYPES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={editCategory?.is_active !== false}
                className="h-4 w-4 accent-qm-lime"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>

            <div className="flex gap-2 pt-2">
              <button type="submit" className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
                Save
              </button>
              <Link
                href={buildUrl()}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>
      )}

      {/* List */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Sub-Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Applies To</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categories.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                  {subTypeFilter
                    ? `No ${SUBTYPE_LABEL[subTypeFilter] ?? subTypeFilter} categories yet.`
                    : typeFilter
                    ? `No ${TYPE_LABEL[typeFilter] ?? typeFilter} categories yet.`
                    : 'No general categories yet.'}
                </td>
              </tr>
            ) : categories.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={buildUrl({ edit: c.id })}
                    className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {c.sub_type ? (SUBTYPE_LABEL[c.sub_type] ?? c.sub_type) : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_BADGE[c.type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {TYPE_LABEL[c.type] ?? c.type}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block h-2 w-2 rounded-full ${c.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={buildUrl({ edit: c.id })}
                    className="text-sm text-qm-lime hover:underline"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-400">
        Categories are used to tag quotes, jobs, and assets. Deactivate a category to hide it from new selections.
      </p>
    </div>
  )
}
