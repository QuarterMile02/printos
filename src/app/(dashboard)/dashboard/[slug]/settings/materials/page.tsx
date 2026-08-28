import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'
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

      <SettingsPageHeader
        title="Materials"
        count={initialResult.totalCount}
        primaryAction={{ label: 'New Material', href: `/dashboard/${slug}/settings/materials/new` }}
        secondaryActions={[
          { label: 'Export CSV', href: `/api/export/materials?orgId=${org.id}`, external: true },
          { label: 'Import CSV', href: `/dashboard/${slug}/settings/materials/import` },
          { label: 'Migrate from ShopVOX', href: `/dashboard/${slug}/settings/materials/migrate` },
          { label: 'Family Workbench', href: `/dashboard/${slug}/settings/materials/families` },
          { label: 'Nesting Sandbox', href: `/dashboard/${slug}/settings/materials/nesting-sandbox` },
        ]}
      />

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
