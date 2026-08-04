import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { resolveDateRange, paginate, type DateRangePreset } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'
import ReportFilters from '../report-filters'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string; status?: string; page?: string }>
}

type InvoiceRow = {
  id: string
  invoice_number: number
  status: string
  subtotal: number | null
  tax_total: number | null
  total: number | null
  balance_due: number | null
  due_date: string | null
  created_at: string
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

const INV_STATUS_OPTIONS = [
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'partial',   label: 'Partial' },
  { value: 'paid',      label: 'Paid' },
  { value: 'overdue',   label: 'Overdue' },
  { value: 'void',      label: 'Void' },
]

const STATUS_COLORS: Record<string, string> = {
  paid:    'bg-green-100 text-green-700',
  partial: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  void:    'bg-gray-100 text-gray-400',
  draft:   'bg-gray-100 text-gray-500',
  sent:    'bg-blue-100 text-blue-700',
}

export default async function InvoicesReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[reports-invoices] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (reports-invoices)</h1>
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
    let q = supabase
      .from('invoices')
      .select('id, invoice_number, status, subtotal, tax_total, total, balance_due, due_date, created_at, customers(first_name, last_name, company_name)', { count: 'exact' })
      .eq('organization_id', org!.id)
      .gte('created_at', range.start)
      .lte('created_at', range.end)
    if (sp.status && sp.status !== 'all') q = q.eq('status', sp.status)
    return q
  }

  const { count: totalCount } = await buildBase().limit(1)
  const total = totalCount ?? 0
  const { from, to, pageCount, page: safePage } = paginate(total, page)
  const { data: rows } = await buildBase()
    .order('invoice_number', { ascending: false })
    .range(from, to) as { data: InvoiceRow[] | null; error: unknown }

  const exportParams = new URLSearchParams()
  if (sp.preset) exportParams.set('preset', sp.preset)
  if (sp.start)  exportParams.set('start', sp.start)
  if (sp.end)    exportParams.set('end', sp.end)
  if (sp.status) exportParams.set('status', sp.status)

  return (
    <ReportShell
      orgSlug={slug}
      title="Invoices"
      totalRows={total}
      page={safePage}
      pageCount={pageCount}
      exportHref={`/api/reports/invoices?org=${org.id}&${exportParams}`}
      extraFilters={<ReportFilters filters={[{ key: 'status', label: 'Status', options: INV_STATUS_OPTIONS }]} />}
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
                    <th className="px-3 py-2 text-right">Subtotal</th>
                    <th className="px-3 py-2 text-right">Tax</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Balance Due</th>
                  </>
                )}
                <th className="px-3 py-2 text-left">Due Date</th>
                <th className="px-3 py-2 text-left">Created</th>
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
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusCls}`}>
                        {r.status}
                      </span>
                    </td>
                    {canSeePricing && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {r.subtotal != null ? `$${(r.subtotal / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {r.tax_total != null && r.tax_total > 0 ? `$${(r.tax_total / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                          {r.total != null ? `$${(r.total / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.balance_due != null && r.balance_due > 0
                            ? <span className="text-red-600">${(r.balance_due / 100).toFixed(2)}</span>
                            : <span className="text-green-600">$0.00</span>}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-2 text-gray-500">
                      {r.due_date ? new Date(r.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                    </td>
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
          No invoices match the selected filters.
        </div>
      )}
    </ReportShell>
  )
}
