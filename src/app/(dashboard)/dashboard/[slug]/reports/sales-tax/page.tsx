import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
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
  created_at: string
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

const TAX_STATUS_OPTIONS = [
  { value: 'sent',    label: 'Sent' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid',    label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
]

export default async function SalesTaxReport({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id, name').eq('slug', slug).maybeSingle() as { data: { id: string; name: string } | null; error: unknown }
  if (!org) notFound()

  const { allowed: canRunReport } = await checkPermission(org.id, 'reports.quotes')
  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')
  if (!canRunReport) notFound()

  const range = resolveDateRange(sp.preset as DateRangePreset | undefined, sp.start, sp.end)
  const page = parseInt(sp.page ?? '1', 10) || 1

  function buildBase() {
    let q = supabase
      .from('invoices')
      .select('id, invoice_number, status, subtotal, tax_total, total, created_at, customers(first_name, last_name, company_name)', { count: 'exact' })
      .eq('organization_id', org!.id)
      .gt('tax_total', 0)
      .not('status', 'in', '("draft","void")')
      .gte('created_at', range.start)
      .lte('created_at', range.end)
    if (sp.status && sp.status !== 'all') q = q.eq('status', sp.status)
    return q
  }

  const { count: totalCount } = await buildBase().limit(1)
  const total = totalCount ?? 0
  const { from, to, pageCount, page: safePage } = paginate(total, page)
  const { data: rows } = await buildBase()
    .order('created_at', { ascending: false })
    .range(from, to) as { data: InvoiceRow[] | null; error: unknown }

  // Totals summary (all matching rows, not just this page)
  const { data: allRows } = await buildBase()
    .select('subtotal, tax_total, total')
    .limit(5000) as { data: { subtotal: number | null; tax_total: number | null; total: number | null }[] | null; error: unknown }

  const totalSubtotal = (allRows ?? []).reduce((s, r) => s + (r.subtotal ?? 0), 0)
  const totalTax      = (allRows ?? []).reduce((s, r) => s + (r.tax_total ?? 0), 0)
  const totalInvoiced = (allRows ?? []).reduce((s, r) => s + (r.total ?? 0), 0)

  const exportParams = new URLSearchParams()
  if (sp.preset) exportParams.set('preset', sp.preset)
  if (sp.start)  exportParams.set('start', sp.start)
  if (sp.end)    exportParams.set('end', sp.end)
  if (sp.status) exportParams.set('status', sp.status)

  return (
    <ReportShell
      orgSlug={slug}
      title="Sales Tax"
      totalRows={total}
      page={safePage}
      pageCount={pageCount}
      exportHref={`/api/reports/sales-tax?org=${org.id}&${exportParams}`}
      extraFilters={<ReportFilters filters={[{ key: 'status', label: 'Status', options: TAX_STATUS_OPTIONS }]} />}
    >
      {canSeePricing && (allRows ?? []).length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          {[
            { label: 'Total Subtotal', value: totalSubtotal, color: 'text-gray-700' },
            { label: 'Total Tax Collected', value: totalTax, color: 'text-[#93ca3b]' },
            { label: 'Total Invoiced', value: totalInvoiced, color: 'text-[#1A1A1A]' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
              <p className={`mt-1 text-xl font-extrabold tabular-nums ${color}`}>
                ${(value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
      )}

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
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-[#ee2b7b]">
                      INV-{String(r.invoice_number).padStart(4, '0')}
                    </td>
                    <td className="px-3 py-2">{customer}</td>
                    <td className="px-3 py-2">
                      <span className="rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                        {r.status}
                      </span>
                    </td>
                    {canSeePricing && (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {r.subtotal != null ? `$${(r.subtotal / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium text-[#93ca3b]">
                          {r.tax_total != null ? `$${(r.tax_total / 100).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {r.total != null ? `$${(r.total / 100).toFixed(2)}` : '—'}
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
          No taxed invoices in this date range.
        </div>
      )}
    </ReportShell>
  )
}
