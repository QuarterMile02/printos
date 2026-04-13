import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  new: 'New', in_progress: 'In Progress', proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup', completed: 'Completed',
}
const STATUS_STYLES: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700', in_progress: 'bg-blue-50 text-blue-700',
  proof_review: 'bg-amber-50 text-amber-700', ready_for_pickup: 'bg-teal-50 text-teal-700',
  completed: 'bg-green-50 text-green-700',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function Page({ params }: { params: Promise<{ slug: string; jobId: string }> }) {
  const { slug, jobId } = await params
  const supabase = await createClient()

  // Org
  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Organization not found</div>

  // Job
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('id, job_number, title, description, status, flag, due_date, source_quote_id, assigned_to, created_at, updated_at, customer_id, customers(first_name, last_name, company_name, email, phone)')
    .eq('id', jobId)
    .eq('organization_id', org.id)
    .single()
  const job = jobRow as {
    id: string; job_number: number; title: string; description: string | null
    status: string; flag: string | null; due_date: string | null
    source_quote_id: string | null; assigned_to: string | null
    created_at: string; updated_at: string; customer_id: string | null
    customers: { first_name: string; last_name: string; company_name: string | null; email: string | null; phone: string | null } | null
  } | null
  if (!job) return <div className="p-8 text-red-600">Job not found</div>

  // Source quote
  let sourceQuoteNum: number | null = null
  let sourceQuoteId: string | null = job.source_quote_id
  if (sourceQuoteId) {
    const { data: q } = await supabase.from('quotes').select('quote_number').eq('id', sourceQuoteId).single()
    sourceQuoteNum = (q as { quote_number: number } | null)?.quote_number ?? null
  }

  // Source sales order
  let soId: string | null = null
  let soNum: number | null = null
  if (sourceQuoteId) {
    const { data: soRow } = await supabase.from('sales_orders').select('id, so_number').eq('quote_id', sourceQuoteId).limit(1).maybeSingle()
    if (soRow) {
      const so = soRow as { id: string; so_number: number }
      soId = so.id
      soNum = so.so_number
    }
  }

  // Assigned team member name
  let assignedName: string | null = null
  if (job.assigned_to) {
    const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('id', job.assigned_to).single()
    const p = profile as { full_name: string | null; email: string } | null
    assignedName = p?.full_name || p?.email || null
  }

  // Workflow stages
  type WfStage = { name: string; sort_order: number }
  let stages: WfStage[] = []
  // Try to get workflow from product linked via quote
  // For now show job status as a simple progress bar
  const statusOrder = ['new', 'in_progress', 'proof_review', 'ready_for_pickup', 'completed']
  const currentIdx = statusOrder.indexOf(job.status)

  return (
    <div className="p-8 max-w-5xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/jobs`} className="hover:text-gray-700">Jobs</Link>
        <span>/</span>
        <span className="text-gray-700">JOB-{String(job.job_number).padStart(4, '0')}</span>
      </div>

      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-extrabold text-gray-900">JOB-{String(job.job_number).padStart(4, '0')}</h1>
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
                {STATUS_LABELS[job.status] ?? job.status}
              </span>
              {job.flag && (
                <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${job.flag === 'file_error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {job.flag === 'file_error' ? 'File Error' : 'Help Needed'}
                </span>
              )}
            </div>
            <p className="mt-1 text-lg font-medium text-gray-900">{job.title}</p>
            {job.customers && (
              <p className="mt-1 text-sm text-gray-600">
                {job.customers.first_name} {job.customers.last_name}
                {job.customers.company_name && <span className="text-gray-400"> &mdash; {job.customers.company_name}</span>}
              </p>
            )}
          </div>
          <div className="text-right text-sm text-gray-500">
            <p>Created {fmtDate(job.created_at)}</p>
            {job.due_date && <p className="mt-1 font-semibold text-gray-700">Due {fmtDate(job.due_date)}</p>}
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          {assignedName && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Assigned To </span>
              <span className="text-gray-700">{assignedName}</span>
            </div>
          )}
          {soId && soNum && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Sales Order </span>
              <Link href={`/dashboard/${slug}/sales-orders/${soId}`} className="text-qm-fuchsia hover:underline font-semibold">
                SO-{String(soNum).padStart(4, '0')}
              </Link>
            </div>
          )}
          {sourceQuoteId && sourceQuoteNum && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Quote </span>
              <Link href={`/dashboard/${slug}/quotes/${sourceQuoteId}`} className="text-qm-fuchsia hover:underline font-semibold">
                Q-{String(sourceQuoteNum).padStart(4, '0')}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Workflow Progress</h2>
        <div className="flex items-center gap-1">
          {statusOrder.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-2 rounded-full ${i <= currentIdx ? 'bg-qm-lime' : 'bg-gray-200'}`} />
              <p className={`mt-1 text-xs text-center ${i <= currentIdx ? 'text-qm-lime-dark font-semibold' : 'text-gray-400'}`}>
                {STATUS_LABELS[s]}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Two column: Description/Notes + Upload Proof */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Notes */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Production Notes</h2>
          {job.description ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.description}</p>
          ) : (
            <p className="text-sm text-gray-400">No production notes.</p>
          )}
        </div>

        {/* Upload Proof */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Upload Proof</h2>
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
            <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            <p className="mt-2 text-sm text-gray-500">Drag and drop or click to upload</p>
            <p className="mt-1 text-xs text-gray-400">PDF, PNG, JPG up to 10MB</p>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="mt-3 block mx-auto text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-qm-lime file:text-white hover:file:brightness-110"
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">File upload storage coming soon. This is a placeholder.</p>
        </div>
      </div>

      {/* Customer card */}
      {job.customers && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Customer</h2>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="font-semibold text-gray-900">{job.customers.first_name} {job.customers.last_name}</span>
              {job.customers.company_name && <p className="text-gray-500">{job.customers.company_name}</p>}
            </div>
            {job.customers.email && (
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Email </span>
                <a href={`mailto:${job.customers.email}`} className="text-qm-fuchsia hover:underline">{job.customers.email}</a>
              </div>
            )}
            {job.customers.phone && (
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Phone </span>
                <a href={`tel:${job.customers.phone}`} className="text-qm-fuchsia hover:underline">{job.customers.phone}</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
