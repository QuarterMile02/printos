import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { uploadProof } from './proof-actions'
import PrintLabelButton from './print-label-button'
import DepartmentSelect from './department-select'
import { checkPermission } from '@/lib/check-permission'
import CustomerContactPicker from '@/components/ui/CustomerContactPicker'
import JobCustomerPicker from './job-customer-picker'
import JobDetailPanel from '../../sales-orders/[id]/job-detail-panel'
import { dbOrThrow, DbError } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

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

type PageProps = { params: Promise<{ slug: string; jobId: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('jobs-detail', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, jobId } = await params
  const supabase = await createClient()

  // Org
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Organization not found</div>

  // Job — this page only needs enough for its own header + the Upload
  // Proof form's line-item dropdown. Everything else (workflow progress,
  // phase dates, workflow steps, production setup, notes, proof history,
  // tasks, QR/time log) lives in JobDetailPanel, shared with the Sales
  // Order detail page's expanded row — see that file for why the split is
  // there.
  type JobShape = {
    id: string; job_number: number; title: string
    status: string; flag: string | null; due_date: string | null
    source_quote_id: string | null; quote_line_item_id: string | null; assigned_to: string | null
    created_at: string; customer_id: string | null
    customers: { first_name: string; last_name: string; company_name: string | null; email: string | null; phone: string | null } | null
    label_printed_at: string | null
    department: string | null
  }

  let job: JobShape | null = null
  const fullSelect = 'id, job_number, title, status, flag, due_date, source_quote_id, quote_line_item_id, assigned_to, created_at, customer_id, label_printed_at, department, customers(first_name, last_name, company_name, email, phone)'
  const { data: jobRow1, error: jobErr1 } = await supabase
    .from('jobs')
    .select(fullSelect)
    .eq('id', jobId)
    .eq('organization_id', org.id)
    .single()
  if (jobRow1) {
    job = jobRow1 as unknown as JobShape
  } else if (jobErr1?.message?.includes('does not exist')) {
    // Older-schema fallback (pre migration 121 too) — degrades
    // quote_line_item_id to null the same way it already degrades
    // label_printed_at/department below.
    const { data: jobRow2 } = await supabase
      .from('jobs')
      .select('id, job_number, title, status, flag, due_date, source_quote_id, assigned_to, created_at, customer_id, customers(first_name, last_name, company_name, email, phone)')
      .eq('id', jobId)
      .eq('organization_id', org.id)
      .single()
    if (jobRow2) job = { ...(jobRow2 as unknown as Omit<JobShape, 'quote_line_item_id' | 'label_printed_at' | 'department'>), quote_line_item_id: null, label_printed_at: null, department: null }
  } else if (jobErr1 && jobErr1.code !== 'PGRST116') {
    // Genuine error (bad UUID, RLS, network, etc.) — not the "0 or >1 rows"
    // shape .single() uses to signal a real not-found. Surface it instead of
    // silently falling through to the not-found UI below.
    throw new DbError(jobErr1)
  }
  if (!job) return <div className="p-8 text-red-600">Job not found</div>

  // Permission: who can assign department
  const { allowed: canAssignDepartment } = await checkPermission(org.id, 'jobs.assign_department')

  // Owner/admin role
  const jobMemberRow = await dbOrThrow(
    supabase
      .from('organization_members').select('role')
      .eq('organization_id', org.id)
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()
  ) as { role: string } | null
  const isOwnerOrAdmin = jobMemberRow?.role === 'owner' || jobMemberRow?.role === 'admin'
  // Owner, admin, or member (sales manager) can reassign the job's customer
  const canReassignJobCustomer = ['owner', 'admin', 'member'].includes(jobMemberRow?.role ?? '')

  // contact_id (migration 058)
  let jobContactId: string | null = null
  let jobContactName: string | null = null
  try {
    const { data: cRow } = await supabase
      .from('jobs').select('contact_id')
      .eq('id', jobId).maybeSingle() as { data: { contact_id?: string | null } | null; error: unknown }
    jobContactId = cRow?.contact_id ?? null
    if (jobContactId) {
      const { data: ccRow } = await supabase
        .from('customer_contacts').select('full_name')
        .eq('id', jobContactId).maybeSingle() as { data: { full_name: string } | null; error: unknown }
      jobContactName = ccRow?.full_name ?? null
    }
  } catch { /* migration 058 not yet applied */ }

  // Source quote
  let sourceQuoteNum: number | null = null
  const sourceQuoteId: string | null = job.source_quote_id
  if (sourceQuoteId) {
    const q = await dbOrThrow(
      supabase.from('quotes').select('quote_number').eq('id', sourceQuoteId).maybeSingle()
    )
    sourceQuoteNum = (q as { quote_number: number } | null)?.quote_number ?? null
  }

  // Source sales order
  let soId: string | null = null
  let soNum: number | null = null
  if (sourceQuoteId) {
    const soRow = await dbOrThrow(
      supabase.from('sales_orders').select('id, so_number').eq('quote_id', sourceQuoteId).limit(1).maybeSingle()
    )
    if (soRow) {
      const so = soRow as { id: string; so_number: number }
      soId = so.id
      soNum = so.so_number
    }
  }

  // Assigned team member name
  let assignedName: string | null = null
  if (job.assigned_to) {
    const profile = await dbOrThrow(
      supabase.from('profiles').select('full_name, email').eq('id', job.assigned_to).maybeSingle()
    )
    const p = profile as { full_name: string | null; email: string } | null
    assignedName = p?.full_name || p?.email || null
  }

  // Line items available to tag a proof against, for this page's own
  // Upload Proof form. Narrowed to just this job's own line item once it
  // has one (migration 121); pre-121 jobs (quote_line_item_id null) keep
  // the old whole-quote dropdown.
  type ProofLineItemOption = { id: string; description: string | null; width: number | null; height: number | null; quantity: number | null }
  let proofLineItemOptions: ProofLineItemOption[] = []
  if (job.source_quote_id) {
    let liOptQuery = supabase
      .from('quote_line_items')
      .select('id, description, width, height, quantity')
      .eq('quote_id', job.source_quote_id)
      .order('sort_order')
    if (job.quote_line_item_id) liOptQuery = liOptQuery.eq('id', job.quote_line_item_id)
    const liOptRows = await dbOrThrow(liOptQuery) as ProofLineItemOption[] | null
    proofLineItemOptions = liOptRows ?? []
  }
  function proofLineItemLabel(li: ProofLineItemOption): string {
    const dims = li.width != null && li.height != null ? ` ${li.width}″×${li.height}″` : ''
    const qty = li.quantity != null && li.quantity !== 1 ? ` × ${li.quantity}` : ''
    return `${li.description ?? 'Line item'}${dims}${qty}`
  }

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
            <JobCustomerPicker
              jobId={job.id}
              orgId={org.id}
              orgSlug={slug}
              initialCustomerId={job.customer_id}
              initialCustomerName={job.customers ? `${job.customers.first_name} ${job.customers.last_name}` : null}
              initialCompanyName={job.customers?.company_name ?? null}
              initialContactId={jobContactId}
              initialContactName={jobContactName}
              canReassign={canReassignJobCustomer}
            />
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="text-right text-sm text-gray-500">
              <p>Created {fmtDate(job.created_at)}</p>
              {job.due_date && <p className="mt-1 font-semibold text-gray-700">Due {fmtDate(job.due_date)}</p>}
            </div>
            <PrintLabelButton jobId={job.id} orgId={org.id} labelPrintedAt={job.label_printed_at} />
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
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1">Department</span>
            <DepartmentSelect
              jobId={job.id}
              orgId={org.id}
              orgSlug={slug}
              currentDepartment={job.department}
              canAssign={canAssignDepartment}
            />
          </div>
        </div>
      </div>

      {/* Shared job-detail body (workflow progress, phase dates, workflow
          steps, production setup, notes, proof history, tasks, QR/time
          log) — same component the Sales Order page's expanded row uses. */}
      <div className="mt-6">
        <JobDetailPanel jobId={job.id} orgId={org.id} orgSlug={slug} showHeader={false} />
      </div>

      {/* Upload Proof — kept on this page only (not in the shared panel):
          this form's line-item dropdown is still needed here since a job
          reached directly (especially a pre-121 legacy job spanning a
          whole SO) may cover more than one line item. The Sales Order
          page's own per-row uploader doesn't need this dropdown since the
          row it's rendered from already says which line item it's for. */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm max-w-md">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Upload Proof</h2>
        <form action={uploadProof}>
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="orgSlug" value={slug} />
          {proofLineItemOptions.length > 0 && (
            <div className="mb-3">
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Line Item</label>
              <select
                name="quoteLineItemId"
                defaultValue={proofLineItemOptions.length === 1 ? proofLineItemOptions[0].id : ''}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              >
                <option value="">— Not tied to a specific line item —</option>
                {proofLineItemOptions.map((li) => (
                  <option key={li.id} value={li.id}>{proofLineItemLabel(li)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-400">Tag which line item this proof is for so it can be bulk-sent for customer review from the Sales Order page.</p>
            </div>
          )}
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-6 text-center">
            <svg className="mx-auto h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            <p className="mt-2 text-sm text-gray-500">PDF, PNG, JPG up to 10MB</p>
            <input
              type="file"
              name="file"
              accept=".pdf,.png,.jpg,.jpeg"
              required
              className="mt-3 block mx-auto text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-qm-lime file:text-white hover:file:brightness-110"
            />
          </div>
          <button type="submit" className="mt-3 rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
            Upload Proof
          </button>
        </form>
      </div>
    </div>
  )
}
