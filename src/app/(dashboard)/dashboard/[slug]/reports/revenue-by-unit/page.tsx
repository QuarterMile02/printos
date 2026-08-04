import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { resolveDateRange, type DateRangePreset } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>
}

type JobRow = {
  department: string | null
  invoice_id: string | null
}

type InvoiceRow = {
  id: string
  total: number | null
  status: string
}

type UnitStat = {
  department: string
  invoiceCount: number
  totalRevenue: number
  jobCount: number
}

export default async function RevenueByUnitReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[reports-revenue-by-unit] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (reports-revenue-by-unit)</h1>
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

  // Fetch jobs with invoice_id + department in range
  const { data: jobs } = await supabase
    .from('jobs')
    .select('department, invoice_id')
    .eq('organization_id', org.id)
    .not('invoice_id', 'is', null)
    .not('department', 'is', null)
    .gte('created_at', range.start)
    .lte('created_at', range.end)
    .limit(2000) as { data: JobRow[] | null; error: unknown }

  // Map invoice_id -> department (first job wins to avoid double-count)
  const invoiceDeptMap = new Map<string, string>()
  const deptJobCount = new Map<string, number>()

  for (const j of jobs ?? []) {
    if (!j.invoice_id || !j.department) continue
    if (!invoiceDeptMap.has(j.invoice_id)) {
      invoiceDeptMap.set(j.invoice_id, j.department)
    }
    deptJobCount.set(j.department, (deptJobCount.get(j.department) ?? 0) + 1)
  }

  const invoiceIds = [...invoiceDeptMap.keys()]
  const unitMap = new Map<string, UnitStat>()

  if (invoiceIds.length > 0) {
    // Fetch invoices in chunks of 200 to avoid URL length limits
    const chunks: string[][] = []
    for (let i = 0; i < invoiceIds.length; i += 200) chunks.push(invoiceIds.slice(i, i + 200))

    for (const chunk of chunks) {
      const { data: invoices } = await supabase
        .from('invoices')
        .select('id, total, status')
        .in('id', chunk)
        .not('status', 'in', '("draft","void","cancelled")') as { data: InvoiceRow[] | null; error: unknown }

      for (const inv of invoices ?? []) {
        const dept = invoiceDeptMap.get(inv.id)
        if (!dept) continue
        if (!unitMap.has(dept)) {
          unitMap.set(dept, { department: dept, invoiceCount: 0, totalRevenue: 0, jobCount: deptJobCount.get(dept) ?? 0 })
        }
        const stat = unitMap.get(dept)!
        stat.invoiceCount++
        stat.totalRevenue += inv.total ?? 0
      }
    }
  }

  const rows = [...unitMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue)
  const grandTotal = rows.reduce((s, r) => s + r.totalRevenue, 0)

  return (
    <ReportShell
      orgSlug={slug}
      title="Revenue by Unit"
      totalRows={rows.length}
      page={1}
      pageCount={1}
      exportHref={`/api/reports/revenue-by-unit?org=${org.id}`}
    >
      {rows.length > 0 ? (
        <>
          {canSeePricing && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Total Revenue (period)</p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-[#1A1A1A]">
                ${(grandTotal / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </p>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Department</th>
                  <th className="px-3 py-2 text-right">Jobs</th>
                  <th className="px-3 py-2 text-right">Invoices</th>
                  {canSeePricing && (
                    <>
                      <th className="px-3 py-2 text-right">Revenue</th>
                      <th className="px-3 py-2 text-right">% of Total</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {rows.map((r) => {
                  const pct = grandTotal > 0 ? Math.round((r.totalRevenue / grandTotal) * 100) : 0
                  return (
                    <tr key={r.department} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-[#1A1A1A] capitalize">
                        {r.department.replace(/_/g, ' ')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.jobCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.invoiceCount}</td>
                      {canSeePricing && (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#1A1A1A]">
                            ${(r.totalRevenue / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <div className="h-1.5 w-16 rounded-full bg-gray-200">
                                <div className="h-full rounded-full bg-[#93ca3b]" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-xs tabular-nums text-gray-600 w-8 text-right">{pct}%</span>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          No invoiced jobs with department data in this date range.
        </div>
      )}
    </ReportShell>
  )
}
