import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow, DbError } from '@/lib/db'
import { resolveDateRange, paginate, type DateRangePreset } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'
import { renderPageError } from '@/lib/page-error'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string; page?: string }>
}

type InvoiceRow = {
  id: string
  invoice_number: number
  status: string
  total: number | null
  balance_due: number | null
  due_date: string | null
  created_at: string
  customer_id: string | null
  customers: { id: string; first_name: string; last_name: string; company_name: string | null } | null
}

type CallLog = {
  customer_id: string
  logged_at: string
  outcome: string | null
}

function daysOverdue(dueDateIso: string | null): number {
  if (!dueDateIso) return 0
  const due = new Date(dueDateIso.length === 10 ? dueDateIso + 'T00:00:00' : dueDateIso).getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - due) / 86_400_000))
}

export default async function CollectionsReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('reports-collections', err)
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

  const { allowed: canRunReport } = await checkPermission(org.id, 'reports.quotes')
  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')
  if (!canRunReport) notFound()

  const range = resolveDateRange(sp.preset as DateRangePreset | undefined, sp.start, sp.end)
  const page = parseInt(sp.page ?? '1', 10) || 1

  function buildBase() {
    return supabase
      .from('invoices')
      .select('id, invoice_number, status, total, balance_due, due_date, created_at, customer_id, customers(id, first_name, last_name, company_name)', { count: 'exact' })
      .eq('organization_id', org!.id)
      .gt('balance_due', 0)
      .not('status', 'in', '("paid","cancelled","draft","void")')
      .gte('created_at', range.start)
      .lte('created_at', range.end)
  }

  const { count: totalCount, error: countError } = await buildBase().limit(1)
  if (countError) throw new DbError(countError)
  const total = totalCount ?? 0
  const { from, to, pageCount, page: safePage } = paginate(total, page)
  const rows = await dbOrThrow(
    buildBase()
      .order('due_date', { ascending: true, nullsFirst: false })
      .range(from, to)
  ) as InvoiceRow[] | null

  // Fetch latest collection call per customer for rows on this page
  const customerIds = [...new Set((rows ?? []).map(r => r.customer_id).filter((id): id is string => !!id))]
  const lastCallMap = new Map<string, { logged_at: string; outcome: string | null }>()

  if (customerIds.length > 0) {
    const callLogs = await dbOrThrow(
      supabase
        .from('collection_call_logs')
        .select('customer_id, logged_at, outcome')
        .eq('organization_id', org.id)
        .in('customer_id', customerIds)
        .order('logged_at', { ascending: false })
    ) as CallLog[] | null

    for (const log of callLogs ?? []) {
      if (!lastCallMap.has(log.customer_id)) {
        lastCallMap.set(log.customer_id, { logged_at: log.logged_at, outcome: log.outcome })
      }
    }
  }

  const exportParams = new URLSearchParams()
  if (sp.preset) exportParams.set('preset', sp.preset)
  if (sp.start)  exportParams.set('start', sp.start)
  if (sp.end)    exportParams.set('end', sp.end)

  return (
    <ReportShell
      orgSlug={slug}
      title="Collections"
      totalRows={total}
      page={safePage}
      pageCount={pageCount}
      exportHref={`/api/reports/collections?org=${org.id}&${exportParams}`}
    >
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Invoice #</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Status</th>
                {canSeePricing && (
                  <>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Balance Due</th>
                  </>
                )}
                <th className="px-3 py-2 text-left">Due Date</th>
                <th className="px-3 py-2 text-right">Days Overdue</th>
                <th className="px-3 py-2 text-left">Last Call</th>
                <th className="px-3 py-2 text-left">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {rows.map((r) => {
                const customer = r.customers
                  ? r.customers.company_name?.trim() || `${r.customers.first_name} ${r.customers.last_name}`.trim()
                  : '—'
                const days = daysOverdue(r.due_date)
                const lastCall = r.customer_id ? lastCallMap.get(r.customer_id) : undefined
                const daysColor = days > 90 ? 'text-red-700 font-bold' : days > 30 ? 'text-orange-600 font-medium' : days > 0 ? 'text-yellow-700' : 'text-gray-500'
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-[#ee2b7b]">
                      INV-{String(r.invoice_number).padStart(4, '0')}
                    </td>
                    <td className="px-3 py-2">{customer}</td>
                    <td className="px-3 py-2">
                      <span className="rounded px-2 py-0.5 text-xs font-medium bg-red-50 text-red-700">
                        {r.status}
                      </span>
                    </td>
                    {canSeePricing && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {r.total != null ? `$${(r.total / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">
                          {r.balance_due != null ? `$${(r.balance_due / 100).toFixed(2)}` : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {r.due_date ? new Date(r.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums text-xs ${daysColor}`}>
                      {days > 0 ? `${days}d` : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {lastCall ? new Date(lastCall.logged_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">
                      {lastCall?.outcome || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          No outstanding invoices in this date range.
        </div>
      )}
    </ReportShell>
  )
}
