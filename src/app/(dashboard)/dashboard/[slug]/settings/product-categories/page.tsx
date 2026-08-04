import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { saveProductCategory } from './actions-sr'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { PRODUCT_CATEGORIES_PAGE_SIZE } from './constants'
import ProductCategoriesListClient, { type ProductCategoryListRow, type ProductTypeOption } from './product-categories-list-client'

export const dynamic = 'force-dynamic'

type ProductCategory = {
  id: string
  name: string
  product_type_id: string | null
  is_active: boolean
  created_at: string
}

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ edit?: string; add?: string; saved?: string; error?: string }>
}

const DB_SELECT = 'id, name, product_type_id, is_active'

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

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
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

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const [memberRows, typesData, initialResult] = await Promise.all([
    dbOrThrow(
      supabase
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', org.id)
    ) as Promise<MemberRow[] | null>,
    dbOrThrow(
      supabase
        .from('product_types')
        .select('id, name')
        .eq('organization_id', org.id)
        .eq('is_active', true)
        .order('name')
    ),
    fetchDataTablePage<ProductCategoryListRow>({
      tableKey: 'product_categories',
      orgId: org.id,
      select: DB_SELECT,
      filterRules: [],
      sortRules: [{ column: 'name', direction: 'asc' }],
      page: 1,
      pageSize: PRODUCT_CATEGORIES_PAGE_SIZE,
    }),
  ])
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const productTypes = (typesData ?? []) as ProductTypeOption[]

  const editId = sp.edit
  const showAdd = sp.add === '1'
  let editCategory: ProductCategory | null = null
  if (editId) {
    const found = await dbOrThrow(
      supabase
        .from('product_categories')
        .select('id, name, product_type_id, is_active, created_at')
        .eq('id', editId).eq('organization_id', org.id).maybeSingle()
    )
    editCategory = (found as ProductCategory | null)
  }
  const isPanelOpen = Boolean(editCategory || showAdd)

  const inputCls = 'mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
  const labelCls = 'block text-xs font-medium text-gray-500'

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Product Categories</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-extrabold text-qm-black">
          Product Categories <span className="text-sm font-normal text-gray-400">({initialResult.totalCount})</span>
        </h1>
        <Link
          href={`/dashboard/${slug}/settings/product-categories?add=1`}
          className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          + New Category
        </Link>
      </div>

      {sp.error && !isPanelOpen && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {decodeURIComponent(sp.error)}
        </div>
      )}

      {isPanelOpen && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          {sp.saved === '1' && (
            <div className="mb-4 rounded-md border border-qm-lime/30 bg-qm-lime/10 px-3 py-2 text-sm font-medium text-qm-lime-dark">
              Saved successfully.
            </div>
          )}
          {sp.error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {decodeURIComponent(sp.error)}
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

      <ProductCategoriesListClient
        initialRows={initialResult.rows}
        initialTotalCount={initialResult.totalCount}
        orgSlug={slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
        productTypes={productTypes}
      />
    </div>
  )
}
