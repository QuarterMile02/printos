import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { DISCOUNTS_PAGE_SIZE } from './constants'
import DiscountsListClient, { type DiscountListRow } from './discounts-list-client'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

export const dynamic = 'force-dynamic'

const DB_SELECT = 'id, name, discount_type, applies_to, active'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('discounts', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const memberRows = await dbOrThrow(
    supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', org.id)
  ) as MemberRow[] | null
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const initialResult = await fetchDataTablePage<DiscountListRow>({
    tableKey: 'discounts',
    orgId: org.id,
    select: DB_SELECT,
    filterRules: [],
    sortRules: [{ column: 'name', direction: 'asc' }],
    page: 1,
    pageSize: DISCOUNTS_PAGE_SIZE,
  })
  if (initialResult.error) throw new Error(initialResult.error)

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Discounts</span>
      </div>

      <SettingsPageHeader
        title="Discounts"
        count={initialResult.totalCount}
        primaryAction={{ label: 'New Discount', href: `/dashboard/${slug}/settings/discounts/new` }}
      />

      <DiscountsListClient
        initialRows={initialResult.rows}
        initialTotalCount={initialResult.totalCount}
        orgSlug={slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
      />
    </div>
  )
}
