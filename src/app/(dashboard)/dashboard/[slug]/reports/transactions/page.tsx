import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow, DbError } from '@/lib/db'
import { resolveDateRange, paginate, type DateRangePreset } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'

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
  amount_paid: number | null
  balance_due: number | null
  created_at: string
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

const STATUS_COLORS: Record<string, string> = {
  paid:    'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  void:    'bg-gray-100 text-gray-400',
  draft:   'bg-gray-100 text-gray-500',
  sent:    'bg-blue-100 text-blue-700',
}

export default async function TransactionsReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[reports-transactions] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (reports-transactions)</h1>
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
  if (!org) notFound()

  const { allowed: canRunReport } = await checkPermission(org.id, 'reports.quotes')
  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')
  if (!canRunReport) notFound()

  const range = resolveDateRange(sp.preset as DateRangePreset | undefined, sp.start, sp.end)
  const page = parseInt(sp.page ?? '1', 10) || 1

  function buildBase() {
    return supabase
      .from('invoices')
      .select('id, invoice_number, status, total, amount_paid, balance_due, created_at, customers(first_name, last_name, company_name)', { count: 'exact' })
      .eq('organization_id', org!.id)
      .neq('status', 'draft')
      .gte('created_at', range.start)
      .lte('created_at', range.end)
  }

  const { count: totalCount, error: countError } = await buildBase().limit(1)
  if (countError) throw new DbError(countError)
  const total = totalCount ?? 0
  const { from, to, pageCount, page: safePage } = paginate(total, page)
  const rows = await dbOrThrow(
    buildBase()
      .order('created_at', { ascending: false })
      .range(from, to)
  ) as InvoiceRow[] | null

  const exportParams = new URLSearchParams()
  if (sp.preset) exportParams.set('preset', sp.preset)
  if (sp.start)  exportParams.set('start', sp.start)
  if (sp.end)    exportParams.set('end', sp.end)

  return (
    <ReportShell
      orgSlug={slug}
      title="Transactions"
      totalRows={total}
      page={safePage}
      pageCount={pageCount}
      exportHref={`/api/reports/transactions?org=${org.id}&${exportParams}`}
    >
      <p className="mb-3 text-xs text-gray-500">
        Invoice ledger. A full payment transaction log will be available once the payments module is enabled.
      </p>
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Invoice #</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Status</th>
                {canSeePricing && (
                  <>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Paid</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                  </>
                )}
                <th className="px-3 py-2 text-left">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {rows.map((r) => {
                const customer = r.customers
                  ? r.customers.company_name?.trim() || `${r.customers.first_name} ${r.customers.last_name}`.trim()
                  : '—'
                const statusCls = STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-600'
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-[#ee2b7b]">
                      INV-{String(r.invoice_number).padStart(4, '0')}
                    </td>
                    <td className="px-3 py-2">{customer}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">Invoice</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusCls}`}>
                        {r.status}
                      </span>
                    </td>
                    {canSeePricing && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.total != null ? `$${(r.total / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-green-700">
                          {r.amount_paid != null && r.amount_paid > 0 ? `$${(r.amount_paid / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.balance_due != null && r.balance_due > 0
                            ? <span className="text-red-600">${(r.balance_due / 100).toFixed(2)}</span>
                            : <span className="text-gray-400">—</span>}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-gray-500">
                      {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          No transactions in this date range.
        </div>
      )}
    </ReportShell>
  )
}
