import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveProductCategory, deleteProductCategory } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'

export const dynamic = 'force-dynamic'

type ProductType = { id: string; name: string; sort_order: number }
type ProductCategory = {
  id: string
  name: string
  product_type_id: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; type?: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[product-categories] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (product-categories)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { allowed } = await checkPermission(org.id, 'settings.product_categories')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Product Categories</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to manage product categories. Contact your organization owner.
        </div>
      </div>
    )
  }

  const [categoriesRes, typesRes] = await Promise.all([
    supabase
      .from('product_categories')
      .select('id, name, product_type_id, sort_order, is_active, created_at')
      .eq('organization_id', org.id)
      .order('sort_order', { ascending: true })
      .order('name'),
    supabase
      .from('product_types')
      .select('id, name, sort_order')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  const allCategories = (categoriesRes.data ?? []) as ProductCategory[]
  const productTypes = (typesRes.data ?? []) as ProductType[]

  const typeFilter = sp.type || ''
  const categories = typeFilter
    ? allCategories.filter(c => c.product_type_id === typeFilter)
    : allCategories

  const editId = sp.edit
  const showAdd = sp.add === '1'
  const editCategory = editId ? allCategories.find(c => c.id === editId) ?? null : null
  const isPanelOpen = Boolean(editCategory || showAdd)

  const typeMap = new Map(productTypes.map(t => [t.id, t.name]))

  // Usage counts — only allow delete when count = 0
  const usageCounts: Record<string, number> = {}
  if (allCategories.length > 0) {
    const { data: usageData } = await supabase
      .from('products')
      .select('product_category_id')
      .eq('organization_id', org.id)
      .not('product_category_id', 'is', null)
    for (const r of (usageData ?? []) as { product_category_id: string }[]) {
      usageCounts[r.product_category_id] = (usageCounts[r.product_category_id] ?? 0) + 1
    }
  }

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Product Categories</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Product Categories <span className="text-sm font-normal text-gray-400">({categories.length})</span>
        </h1>
        <Link
          href={`/dashboard/${slug}/settings/product-categories?add=1`}
          className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          + New Category
        </Link>
      </div>

      {/* Filter bar */}
      <form className="mb-4 flex flex-wrap gap-3">
        <select
          name="type"
          defaultValue={typeFilter}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="">All Product Types</option>
          {productTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button type="submit" className="rounded-md bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
          Filter
        </button>
        {typeFilter && (
          <Link href={`/dashboard/${slug}/settings/product-categories`} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Clear
          </Link>
        )}
      </form>

      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">
            {editCategory ? 'Edit Product Category' : 'New Product Category'}
          </h2>
          <form action={saveProductCategory} className="space-y-4">
            {editCategory && <input type="hidden" name="id" value={editCategory.id} />}
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Name *</label>
                <input type="text" name="name" required defaultValue={editCategory?.name ?? ''} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Product Type</label>
                <select
                  name="product_type_id"
                  defaultValue={editCategory?.product_type_id ?? ''}
                  className={inputCls}
                >
                  <option value="">— None —</option>
                  {productTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Sort Order</label>
                <input
                  type="number"
                  name="sort_order"
                  defaultValue={editCategory?.sort_order ?? (allCategories.length + 1) * 10}
                  className={inputCls}
                />
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
                href={`/dashboard/${slug}/settings/product-categories`}
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
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Product Type</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Sort</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Products</th>
              <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categories.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  {typeFilter ? 'No categories for this product type.' : 'No product categories yet.'}
                </td>
              </tr>
            ) : categories.map(c => {
              const inUse = (usageCounts[c.id] ?? 0) > 0
              return (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/${slug}/settings/product-categories?edit=${c.id}`}
                      className="text-sm font-medium text-gray-900 hover:text-qm-fuchsia"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {c.product_type_id ? (typeMap.get(c.product_type_id) ?? '—') : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 text-right tabular-nums">{c.sort_order}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 text-right tabular-nums">
                    {usageCounts[c.id] ?? 0}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${c.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/dashboard/${slug}/settings/product-categories?edit=${c.id}`}
                        className="text-sm text-qm-lime hover:underline"
                      >
                        Edit
                      </Link>
                      {!inUse && (
                        <form action={deleteProductCategory} className="inline">
                          <input type="hidden" name="id" value={c.id} />
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
