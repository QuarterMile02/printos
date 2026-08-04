import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { DISCOUNTS_PAGE_SIZE } from './constants'
import DiscountsListClient, { type DiscountListRow } from './discounts-list-client'
import { dbOrThrow } from '@/lib/db'

export const dynamic = 'force-dynamic'

const DB_SELECT = 'id, name, discount_type, applies_to, active'

type PageProps = { params: Promise<{ slug: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[discounts] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (discounts)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
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

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Discounts</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-extrabold text-qm-black">Discounts <span className="text-sm font-normal text-gray-400">({initialResult.totalCount})</span></h1>
        <Link href={`/dashboard/${slug}/settings/discounts/new`} className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
          + New Discount
        </Link>
      </div>

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
