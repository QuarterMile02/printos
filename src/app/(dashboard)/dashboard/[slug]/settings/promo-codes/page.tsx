import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { PROMO_CODES_PAGE_SIZE } from './constants'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'
import PromoCodesListClient, { type PromoCodeListRow } from './promo-codes-list-client'

export const dynamic = 'force-dynamic'

const DB_SELECT = 'id, name, code, discount_type, value, minimum_requirement, limit_of_using, valid_from, valid_to, is_active'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('promo-codes', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { allowed } = await checkPermission(org.id, 'settings.promo_codes')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Promo Codes</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to manage promo codes. Contact your organization owner.
        </div>
      </div>
    )
  }

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

  const initialResult = await fetchDataTablePage<PromoCodeListRow>({
    tableKey: 'promo_codes',
    orgId: org.id,
    select: DB_SELECT,
    filterRules: [],
    sortRules: [{ column: 'name', direction: 'asc' }],
    page: 1,
    pageSize: PROMO_CODES_PAGE_SIZE,
  })
  if (initialResult.error) throw new Error(initialResult.error)

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Promo Codes</span>
      </div>

      <SettingsPageHeader
        title="Promo Codes"
        count={initialResult.totalCount}
        description="Settings/management only for now — not yet wired into quotes or a customer checkout flow."
        primaryAction={{ label: 'New Promo Code', href: `/dashboard/${slug}/settings/promo-codes/new` }}
      />

      <PromoCodesListClient
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
