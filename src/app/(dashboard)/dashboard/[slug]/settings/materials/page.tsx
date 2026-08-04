import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { MATERIALS_PAGE_SIZE } from './constants'
import MaterialsListClient, { type MaterialListRow, type MaterialTypeOption, type MaterialCategoryOption } from './materials-list-client'

export const dynamic = 'force-dynamic'

const DB_SELECT = 'id, name, external_name, cost, price, selling_units, material_type_id, category_id, active'

type PageProps = { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('materials', err)
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

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const [memberRows, materialTypesData, materialCategoriesData, initialResult] = await Promise.all([
    dbOrThrow(
      supabase
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', org.id)
    ) as Promise<MemberRow[] | null>,
    dbOrThrow(
      supabase
        .from('material_types')
        .select('id, name')
        .eq('organization_id', org.id)
        .eq('is_active', true)
        .order('name')
    ),
    dbOrThrow(
      supabase
        .from('material_categories')
        .select('id, name')
        .eq('organization_id', org.id)
        .eq('is_active', true)
        .order('name')
    ),
    fetchDataTablePage<MaterialListRow>({
      tableKey: 'materials',
      orgId: org.id,
      select: DB_SELECT,
      filterRules: [],
      sortRules: [{ column: 'name', direction: 'asc' }],
      page: 1,
      pageSize: MATERIALS_PAGE_SIZE,
    }),
  ])
  if (initialResult.error) throw new Error(initialResult.error)
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const materialTypes = (materialTypesData ?? []) as MaterialTypeOption[]
  const materialCategories = (materialCategoriesData ?? []) as MaterialCategoryOption[]

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Materials</span>
      </div>

      {sp.error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {decodeURIComponent(sp.error)}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-qm-black">Materials <span className="text-sm font-normal text-gray-400">({initialResult.totalCount.toLocaleString()})</span></h1>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/export/materials?orgId=${org.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 transition-colors"
          >
            Export CSV
          </a>
          <Link
            href={`/dashboard/${slug}/settings/materials/import`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 transition-colors"
          >
            Import CSV
          </Link>
          <Link
            href={`/dashboard/${slug}/settings/materials/new`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Material
          </Link>
        </div>
      </div>

      <MaterialsListClient
        initialRows={initialResult.rows}
        initialTotalCount={initialResult.totalCount}
        orgSlug={slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
        materialTypes={materialTypes}
        materialCategories={materialCategories}
      />
    </div>
  )
}
