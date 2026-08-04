import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow, DbError } from '@/lib/db'
import { resolveDateRange, paginate, type DateRangePreset } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'
import ReportFilters from '../report-filters'
import { renderPageError } from '@/lib/page-error'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string; status?: string; page?: string }>
}

type CustomerRow = {
  id: string
  first_name: string
  last_name: string
  company_name: string | null
  email: string | null
  phone: string | null
  status: string | null
  is_active: boolean | null
  created_at: string
}

const CUSTOMER_STATUS_OPTIONS = [
  { value: 'lead',      label: 'Lead' },
  { value: 'prospect',  label: 'Prospect' },
  { value: 'closable',  label: 'Closable' },
  { value: 'sold',      label: 'Sold' },
]

export default async function CustomersReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('reports-customers', err)
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
  if (!canRunReport) notFound()

  const range = resolveDateRange(sp.preset as DateRangePreset | undefined, sp.start, sp.end)
  const page = parseInt(sp.page ?? '1', 10) || 1

  function buildBase() {
    let q = supabase
      .from('customers')
      .select('id, first_name, last_name, company_name, email, phone, status, is_active, created_at', { count: 'exact' })
      .eq('organization_id', org!.id)
      .gte('created_at', range.start)
      .lte('created_at', range.end)
    if (sp.status && sp.status !== 'all') q = q.eq('status', sp.status)
    return q
  }

  const { count: totalCount, error: countError } = await buildBase().limit(1)
  if (countError) throw new DbError(countError)
  const total = totalCount ?? 0
  const { from, to, pageCount, page: safePage } = paginate(total, page)
  const rows = await dbOrThrow(
    buildBase()
      .order('company_name', { ascending: true, nullsFirst: false })
      .range(from, to)
  ) as CustomerRow[] | null

  const exportParams = new URLSearchParams()
  if (sp.preset) exportParams.set('preset', sp.preset)
  if (sp.start)  exportParams.set('start', sp.start)
  if (sp.end)    exportParams.set('end', sp.end)
  if (sp.status) exportParams.set('status', sp.status)

  return (
    <ReportShell
      orgSlug={slug}
      title="Customers"
      totalRows={total}
      page={safePage}
      pageCount={pageCount}
      exportHref={`/api/reports/customers?org=${org.id}&${exportParams}`}
      extraFilters={<ReportFilters filters={[{ key: 'status', label: 'Status', options: CUSTOMER_STATUS_OPTIONS }]} />}
    >
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Active</th>
                <th className="px-3 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {rows.map((r) => {
                const displayName = r.company_name?.trim()
                  || `${r.first_name} ${r.last_name}`.trim()
                const subName = r.company_name?.trim() ? `${r.first_name} ${r.last_name}`.trim() : null
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-[#1A1A1A]">{displayName}</div>
                      {subName && <div className="text-xs text-gray-500">{subName}</div>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.email || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.phone || '—'}</td>
                    <td className="px-3 py-2">
                      {r.status ? (
                        <span className="rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                          {r.status}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${r.is_active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.is_active !== false ? 'Yes' : 'No'}
                      </span>
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
          No customers match the selected filters.
        </div>
      )}
    </ReportShell>
  )
}
