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
  searchParams: Promise<{ preset?: string; start?: string; end?: string; status?: string; department?: string; page?: string }>
}

type JobRow = {
  id: string
  job_number: number
  title: string | null
  description: string | null
  status: string
  department: string | null
  due_date: string | null
  created_at: string
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

const JOB_STATUS_OPTIONS = [
  { value: 'new',              label: 'New' },
  { value: 'in_progress',      label: 'In Progress' },
  { value: 'proof_review',     label: 'Proof Review' },
  { value: 'ready_for_pickup', label: 'Ready for Pickup' },
  { value: 'completed',        label: 'Completed' },
]

const DEPT_OPTIONS = [
  { value: 'large_format',      label: 'Large Format' },
  { value: 'commercial_print',  label: 'Commercial Print' },
  { value: 'design',            label: 'Design' },
  { value: 'branding',          label: 'Branding' },
  { value: 'installation',      label: 'Installation' },
  { value: 'vehicle_wrap',      label: 'Vehicle Wrap' },
  { value: 'channel_letters',   label: 'Channel Letters' },
  { value: 'fabrication',       label: 'Fabrication' },
  { value: 'digital_marketing', label: 'Digital Marketing' },
  { value: 'digital_screens',   label: 'Digital Screens' },
  { value: 'direct_mail',       label: 'Direct Mail' },
  { value: 'promotional',       label: 'Promotional' },
  { value: 'apparel',           label: 'Apparel' },
  { value: 'service_repair',    label: 'Service & Repair' },
]

const STATUS_COLORS: Record<string, string> = {
  new:              'bg-gray-100 text-gray-600',
  in_progress:      'bg-blue-100 text-blue-700',
  proof_review:     'bg-yellow-100 text-yellow-700',
  ready_for_pickup: 'bg-green-100 text-green-700',
  completed:        'bg-green-100 text-green-700',
}

export default async function JobsReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('reports-jobs', err)
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
      .from('jobs')
      .select('id, job_number, title, description, status, department, due_date, created_at, customers(first_name, last_name, company_name)', { count: 'exact' })
      .eq('organization_id', org!.id)
      .gte('created_at', range.start)
      .lte('created_at', range.end)
    if (sp.status && sp.status !== 'all') q = q.eq('status', sp.status)
    if (sp.department && sp.department !== 'all') q = q.eq('department', sp.department)
    return q
  }

  const { count: totalCount, error: countError } = await buildBase().limit(1)
  if (countError) throw new DbError(countError)
  const total = totalCount ?? 0
  const { from, to, pageCount, page: safePage } = paginate(total, page)
  const rows = await dbOrThrow(
    buildBase()
      .order('job_number', { ascending: false })
      .range(from, to)
  ) as JobRow[] | null

  const today = new Date().toISOString().slice(0, 10)

  const exportParams = new URLSearchParams()
  if (sp.preset)     exportParams.set('preset', sp.preset)
  if (sp.start)      exportParams.set('start', sp.start)
  if (sp.end)        exportParams.set('end', sp.end)
  if (sp.status)     exportParams.set('status', sp.status)
  if (sp.department) exportParams.set('department', sp.department)

  return (
    <ReportShell
      orgSlug={slug}
      title="Jobs"
      totalRows={total}
      page={safePage}
      pageCount={pageCount}
      exportHref={`/api/reports/jobs?org=${org.id}&${exportParams}`}
      extraFilters={
        <ReportFilters filters={[
          { key: 'status',     label: 'Status',     options: JOB_STATUS_OPTIONS },
          { key: 'department', label: 'Department', options: DEPT_OPTIONS },
        ]} />
      }
    >
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Job #</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Department</th>
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
                const isOverdue = r.due_date && r.due_date < today && r.status !== 'completed'
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs text-[#ee2b7b]">
                      J-{String(r.job_number).padStart(4, '0')}
                    </td>
                    <td className="px-3 py-2">{customer}</td>
                    <td className="px-3 py-2 text-gray-700 max-w-[200px] truncate">
                      {r.title || r.description || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusCls}`}>
                        {r.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs">
                      {r.department ? r.department.replace(/_/g, ' ') : '—'}
                    </td>
                    <td className={`px-3 py-2 text-xs ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
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
          No jobs match the selected filters.
        </div>
      )}
    </ReportShell>
  )
}
