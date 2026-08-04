import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { checkPermission } from '@/lib/check-permission'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { QUOTES_PAGE_SIZE } from './constants'
import QuotesListClient, { type QuoteListRow } from './quotes-list-client'
import { dbOrThrow } from '@/lib/db'

type PageProps = {
  params: Promise<{ slug: string }>
}

export default async function QuotesPage(props: PageProps) {
  try {
    return await QuotesPageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[quotes-list] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (quotes-list)</h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function QuotesPageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  // Org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null

  if (!org) notFound()

  // User role within org
  type MemberRow = { user_id: string; role: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', org.id) as { data: MemberRow[] | null; error: unknown }

  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')

  // SSR page-1 data — uses quotes.total directly (maintained by recalcQuoteTotals)
  const DB_SELECT = 'id, quote_number, title, status, created_at, total, customer_id, customers(first_name, last_name, company_name)'
  const { rows: initialRows, totalCount: initialTotalCount } = await fetchDataTablePage({
    tableKey: 'quotes',
    orgId: org.id,
    select: DB_SELECT,
    filterRules: [],
    sortRules: [{ column: 'quote_number', direction: 'desc' }],
    page: 1,
    pageSize: QUOTES_PAGE_SIZE,
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-700">Quotes</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-qm-black">Quotes</h1>
          <Link
            href={`/dashboard/${slug}/quotes/new`}
            className="inline-flex items-center gap-2 rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-105"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Quote
          </Link>
        </div>
      </div>

      <QuotesListClient
        initialRows={initialRows as QuoteListRow[]}
        initialTotalCount={initialTotalCount}
        orgSlug={org.slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
        canSeePricing={canSeePricing}
      />
    </div>
  )
}
