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

type Category = {
  id: string
  name: string
  type: string
  is_active: boolean
  created_at: string
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; type?: string; sort?: string }>
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

  let query = supabase
    .from('general_categories')
    .select('id, name, type, is_active, created_at')
    .eq('organization_id', org.id)
    .order('name', { ascending: !sortDesc })

  if (typeFilter) query = query.eq('type', typeFilter)

  const { data: allRes } = await query
  const categories = (allRes ?? []) as Category[]

  const editId = sp.edit
  const showAdd = sp.add === '1'

  // For "edit" we need the category even if it doesn't match the current filter
  let editCategory: Category | null = null
  if (editId) {
    editCategory = categories.find(c => c.id === editId) ?? null
    if (!editCategory) {
      const { data: found } = await supabase
        .from('general_categories')
        .select('id, name, type, is_active, created_at')
        .eq('id', editId)
        .eq('organization_id', org.id)
        .single()
      editCategory = (found as Category | null)
    }
  }

  const isPanelOpen = Boolean(editCategory || showAdd)

  // Sort-toggle URL — preserve type filter
  const sortLinkParams = new URLSearchParams()
  if (typeFilter) sortLinkParams.set('type', typeFilter)
  if (!sortDesc) sortLinkParams.set('sort', 'desc')
  const sortLinkQs = sortLinkParams.toString()

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">General Categories</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          General Categories <span className="text-sm font-normal text-gray-400">({categories.length})</span>
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${slug}/settings/general-categories${sortLinkQs ? `?${sortLinkQs}` : ''}`}
            className={`inline-flex items-center rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${!sortDesc ? 'border-qm-lime/40 bg-qm-lime/10 text-green-700' : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            {sortDesc ? 'Z-A ↓' : 'A-Z ↑'}
          </Link>
          <Link
            href={`/dashboard/${slug}/settings/general-categories?add=1`}
            className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            + New Category
          </Link>
        </div>
      </div>

      {/* Type filter bar */}
      <form className="mb-4 flex flex-wrap gap-2">
        {sortDesc && <input type="hidden" name="sort" value="desc" />}
        <select
          name="type"
          defaultValue={typeFilter}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
          Filter
        </button>
        {typeFilter && (
          <Link
            href={`/dashboard/${slug}/settings/general-categories${sortDesc ? '?sort=desc' : ''}`}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Name *</label>
                <input type="text" name="name" required defaultValue={editCategory?.name ?? ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Type *</label>
                <select name="type" required defaultValue={editCategory?.type ?? 'asset'} className={inputCls}>
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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
                href={`/dashboard/${slug}/settings/general-categories`}
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
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categories.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
                  {typeFilter ? `No ${TYPE_LABEL[typeFilter] ?? typeFilter} categories yet.` : 'No general categories yet.'}
                </td>
              </tr>
            ) : categories.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/${slug}/settings/general-categories?edit=${c.id}`}
                    className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia"
                  >
                    {c.name}
                  </Link>
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
                    href={`/dashboard/${slug}/settings/general-categories?edit=${c.id}`}
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
