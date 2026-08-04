import Link from 'next/link'
import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow, DbError } from '@/lib/db'
import type { QuoteStatus } from '@/types/database'
import { resolveDateRange, paginate, PAGE_SIZE } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'
import QuotesFilters from './quotes-filters'
import { renderPageError } from '@/lib/page-error'

export const dynamic = 'force-dynamic'

const ALL_STATUSES: QuoteStatus[] = [
  'draft','delivered','customer_review','approved','internally_approved',
  'approve_with_changes','revise','ordered','hold','expired','lost','pending','no_charge',
]

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    preset?: string; start?: string; end?: string;
    status?: string; sales_rep?: string; page?: string;
  }>
}

type QuoteJoinRow = {
  id: string
  quote_number: number
  title: string
  status: QuoteStatus
  created_at: string
  total: number | null
  sales_rep_id: string | null
  customer_id: string | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

type SalesRep = { id: string; name: string }

export default async function QuotesReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('reports-quotes', err)
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) notFound()

  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')
  const { allowed: canRunReport } = await checkPermission(org.id, 'reports.quotes')
  if (!canRunReport) notFound()

  const range = resolveDateRange(sp.preset as 'today' | 'this_week' | 'this_month' | 'last_30' | 'last_90' | 'ytd' | 'custom' | undefined, sp.start, sp.end)
  const page = parseInt(sp.page ?? '1', 10) || 1

  // Sales reps for the filter dropdown via service client (bypasses RLS).
  type RawMemberRow = { user_id: string }
  const memberRows = await dbOrThrow(
    supabase
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', org.id)
      .in('role', ['owner', 'admin', 'member'])
  ) as RawMemberRow[] | null

  const memberUserIds = (memberRows ?? []).map(m => m.user_id)
  const service = createServiceClient()
  const repNameMap = new Map<string, string>()

  if (memberUserIds.length > 0) {
    type ProfileRow = { id: string; full_name: string | null }
    const profileRows = await dbOrThrow(
      service
        .from('profiles')
        .select('id, full_name')
        .in('id', memberUserIds)
    ) as ProfileRow[] | null
    for (const p of profileRows ?? []) {
      repNameMap.set(p.id, p.full_name ?? p.id)
    }
    const missing = memberUserIds.filter(id => !repNameMap.has(id))
    if (missing.length > 0) {
      const { data: { users: authUsers } } = await service.auth.admin.listUsers()
      for (const u of authUsers ?? []) {
        if (!repNameMap.has(u.id) && u.email) repNameMap.set(u.id, u.email)
      }
    }
  }

  const salesReps: SalesRep[] = memberUserIds
    .map(id => ({ id, name: repNameMap.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Build base query (count + paged data) honouring filters.
  function buildBase() {
    let q = supabase
      .from('quotes')
      .select('id, quote_number, title, status, created_at, total, sales_rep_id, customer_id, customers(first_name, last_name, company_name)', { count: 'exact' })
      .eq('organization_id', org!.id)
      .gte('created_at', range.start)
      .lte('created_at', range.end)
    if (sp.status && sp.status !== 'all') q = q.eq('status', sp.status)
    if (sp.sales_rep && sp.sales_rep !== 'all') q = q.eq('sales_rep_id', sp.sales_rep)
    return q
  }

  // 1) Count first (for pagination math)
  const { count: totalCount, error: countError } = await buildBase().limit(1)
  if (countError) throw new DbError(countError)
  const total = totalCount ?? 0
  const { from, to, pageCount, page: safePage } = paginate(total, page)

  // 2) Page query
  const rows = await dbOrThrow(
    buildBase()
      .order('quote_number', { ascending: false })
      .range(from, to)
  ) as QuoteJoinRow[] | null

  const repNameById = new Map(salesReps.map((r) => [r.id, r.name]))

  const exportParams = new URLSearchParams()
  if (sp.preset)    exportParams.set('preset', sp.preset)
  if (sp.start)     exportParams.set('start', sp.start)
  if (sp.end)       exportParams.set('end', sp.end)
  if (sp.status)    exportParams.set('status', sp.status)
  if (sp.sales_rep) exportParams.set('sales_rep', sp.sales_rep)
  const exportHref = `/api/reports/quotes?org=${org.id}&${exportParams.toString()}`

  return (
    <ReportShell
      orgSlug={slug}
      title="Quotes Report"
      totalRows={total}
      page={safePage}
      pageCount={pageCount}
      exportHref={exportHref}
      extraFilters={
        <QuotesFilters
          allStatuses={ALL_STATUSES}
          salesReps={salesReps}
          currentStatus={sp.status ?? 'all'}
          currentSalesRep={sp.sales_rep ?? 'all'}
        />
      }
    >
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Quote #</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Sales Rep</th>
                {canSeePricing && <th className="px-3 py-2 text-right">Total</th>}
                <th className="px-3 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {rows.map((r) => {
                const customer = r.customers
                  ? r.customers.company_name?.trim() || `${r.customers.first_name} ${r.customers.last_name}`.trim()
                  : '—'
                const repName = r.sales_rep_id ? repNameById.get(r.sales_rep_id) ?? '—' : '—'
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/dashboard/${slug}/quotes/${r.id}`} className="text-[#ee2b7b] hover:underline">
                        Q-{String(r.quote_number).padStart(4, '0')}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{customer}</td>
                    <td className="px-3 py-2 text-gray-700">{r.title}</td>
                    <td className="px-3 py-2 text-gray-700">{r.status.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-gray-700">{repName}</td>
                    {canSeePricing && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.total != null ? `$${(r.total / 100).toFixed(2)}` : '—'}
                      </td>
                    )}
                    <td className="px-3 py-2 text-gray-500">{new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          No quotes match the selected filters.
        </div>
      )}
      {/* Page-size hint kept off-screen — visible counts are in the shell footer. */}
      <input type="hidden" value={PAGE_SIZE} readOnly />
    </ReportShell>
  )
}
