import { createClient, createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { uploadProof, updateProofStatus } from './proof-actions'
import { updateJobPhaseDates } from '../actions'
import { generateQRDataUrl } from '@/lib/qr'
import PrintLabelButton from './print-label-button'
import DepartmentSelect from './department-select'
import WorkflowChecklist, { type WorkflowStep, type WorkflowProgress } from './workflow-checklist'
import { checkPermission } from '@/lib/check-permission'
import CustomerContactPicker from '@/components/ui/CustomerContactPicker'
import JobCustomerPicker from './job-customer-picker'

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

  // Job. material_selection / assigned_printer may not exist on older
  // schemas — fetch them defensively and degrade if the columns are missing.
  type MaterialLine = {
    line_item_id: string
    selected_material_id: string | null
    selected_material_name: string | null
    roll_width_inches: number | null
    actual_print_width: number
    actual_print_height: number
    hem_allowance_applied: boolean
    assigned_printer: 'Epson' | 'Swiss Q' | null
    two_up_candidate: boolean
    two_up_roll_width: number | null
    material_used_sqft: number
    low_stock_warning: boolean
    low_stock_message: string | null
    no_material_found?: boolean
    reason?: string | null
  }
  type JobShape = {
    id: string; job_number: number; title: string; description: string | null
    status: string; flag: string | null; due_date: string | null
    source_quote_id: string | null; assigned_to: string | null
    created_at: string; updated_at: string; customer_id: string | null
    customers: { first_name: string; last_name: string; company_name: string | null; email: string | null; phone: string | null } | null
    material_selection: { line_items?: MaterialLine[]; computed_at?: string } | null
    assigned_printer: string | null
    label_printed_at: string | null
    department: string | null
    production_due_date: string | null
    fabrication_due_date: string | null
    installation_due_date: string | null
  }

  let job: JobShape | null = null
  const fullSelect = 'id, job_number, title, description, status, flag, due_date, source_quote_id, assigned_to, created_at, updated_at, customer_id, material_selection, assigned_printer, label_printed_at, department, production_due_date, fabrication_due_date, installation_due_date, customers(first_name, last_name, company_name, email, phone)'
  const { data: jobRow1, error: jobErr1 } = await supabase
    .from('jobs')
    .select(fullSelect)
    .eq('id', jobId)
    .eq('organization_id', org.id)
    .single()
  if (jobRow1) {
    job = jobRow1 as unknown as JobShape
  } else if (jobErr1?.message?.includes('does not exist')) {
    const { data: jobRow2 } = await supabase
      .from('jobs')
      .select('id, job_number, title, description, status, flag, due_date, source_quote_id, assigned_to, created_at, updated_at, customer_id, customers(first_name, last_name, company_name, email, phone)')
      .eq('id', jobId)
      .eq('organization_id', org.id)
      .single()
    if (jobRow2) job = { ...(jobRow2 as unknown as Omit<JobShape, 'material_selection' | 'assigned_printer' | 'label_printed_at' | 'department' | 'production_due_date' | 'fabrication_due_date' | 'installation_due_date'>), material_selection: null, assigned_printer: null, label_printed_at: null, department: null, production_due_date: null, fabrication_due_date: null, installation_due_date: null }
  }
  if (!job) return <div className="p-8 text-red-600">Job not found</div>

  // Permission: who can assign department
  const { allowed: canAssignDepartment } = await checkPermission(org.id, 'jobs.assign_department')

  // Owner/admin role
  const { data: jobMemberRow } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', org.id)
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
    .maybeSingle() as { data: { role: string } | null; error: unknown }
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

  // Workflow steps: product_default_items where workflow_step=true for this job's products
  const service = createServiceClient()
  const workflowSteps: WorkflowStep[] = []
  const workflowProgress: WorkflowProgress[] = []

  if (job.source_quote_id) {
    // 1. Get product_ids from quote line items
    type LiProd = { product_id: string | null }
    const { data: liRows } = await service
      .from('quote_line_items')
      .select('product_id')
      .eq('quote_id', job.source_quote_id)
      .not('product_id', 'is', null) as { data: LiProd[] | null; error: unknown }

    const productIds = [...new Set((liRows ?? []).map((r) => r.product_id).filter(Boolean) as string[])]

    if (productIds.length > 0) {
      // 2. Fetch workflow steps from product_default_items
      type PdiRow = {
        id: string; item_type: string; custom_item_name: string | null; sort_order: number
        materials: { name: string } | null
        labor_rates: { name: string } | null
        machine_rates: { name: string } | null
      }
      const { data: pdiRows } = await service
        .from('product_default_items')
        .select('id, item_type, custom_item_name, sort_order, materials(name), labor_rates(name), machine_rates(name)')
        .in('product_id', productIds)
        .eq('workflow_step', true)
        .order('sort_order') as { data: PdiRow[] | null; error: unknown }

      for (const r of pdiRows ?? []) {
        let name = r.custom_item_name
        if (!name && r.item_type === 'Material')     name = r.materials?.name ?? null
        if (!name && r.item_type === 'LaborRate')    name = r.labor_rates?.name ?? null
        if (!name && r.item_type === 'MachineRate')  name = r.machine_rates?.name ?? null
        workflowSteps.push({ id: r.id, name: name ?? 'Step', sortOrder: r.sort_order })
      }
    }

    // 3. Fetch existing progress for this job
    type ProgRow = { step_name: string; checked_by: string | null; checked_at: string | null }
    const { data: progRows } = await service
      .from('jobs_workflow_progress')
      .select('step_name, checked_by, checked_at')
      .eq('job_id', jobId) as { data: ProgRow[] | null; error: unknown }

    // Resolve checked_by user names
    const checkerIds = [...new Set((progRows ?? []).map((p) => p.checked_by).filter(Boolean) as string[])]
    const nameMap = new Map<string, string>()
    if (checkerIds.length > 0) {
      const { data: profiles } = await service
        .from('profiles').select('id, full_name').in('id', checkerIds) as { data: { id: string; full_name: string | null }[] | null; error: unknown }
      for (const p of profiles ?? []) if (p.full_name) nameMap.set(p.id, p.full_name)
    }

    for (const p of progRows ?? []) {
      workflowProgress.push({
        stepName: p.step_name,
        checkedByName: p.checked_by ? (nameMap.get(p.checked_by) ?? null) : null,
        checkedAt: p.checked_at,
      })
    }
  }

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

  // Proof versions
  const { data: proofRows } = await supabase
    .from('proof_versions')
    .select('id, file_url, file_name, version_number, status, created_at')
    .eq('job_id', jobId)
    .order('version_number', { ascending: false })
  const proofs = (proofRows ?? []) as {
    id: string; file_url: string; file_name: string; version_number: number
    status: string; created_at: string
  }[]

  const proofStatusStyles: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700',
    approved: 'bg-green-50 text-green-700',
    rejected: 'bg-red-50 text-red-700',
  }

  // Time logs
  const { data: timeLogRows } = await supabase
    .from('job_time_logs')
    .select('id, action, stage, duration_minutes, scanned_at, user_id')
    .eq('job_id', jobId)
    .order('scanned_at', { ascending: false })
  const timeLogs = (timeLogRows ?? []) as {
    id: string; action: string; stage: string | null; duration_minutes: number | null
    scanned_at: string; user_id: string | null
  }[]
  const totalMinutes = timeLogs
    .filter(l => l.duration_minutes)
    .reduce((sum, l) => sum + Number(l.duration_minutes ?? 0), 0)
  const totalHrs = Math.floor(totalMinutes / 60)
  const totalMins = Math.round(totalMinutes % 60)

  // Line item names for the Production Setup labels — pulled from
  // the source quote so each material card can show "Banner 48×96".
  const materialLines = job.material_selection?.line_items ?? []
  const lineItemLabels = new Map<string, string>()
  const lineItemQty = new Map<string, number>()
  if (materialLines.length > 0 && job.source_quote_id) {
    type LiRow = { id: string; description: string | null; width: number | null; height: number | null; quantity: number | null }
    const { data: liRows } = await supabase
      .from('quote_line_items')
      .select('id, description, width, height, quantity')
      .in('id', materialLines.map((l) => l.line_item_id)) as { data: LiRow[] | null; error: unknown }
    for (const li of liRows ?? []) {
      const dims = li.width != null && li.height != null ? ` ${li.width}″×${li.height}″` : ''
      const qty = li.quantity != null && li.quantity !== 1 ? ` × ${li.quantity}` : ''
      lineItemLabels.set(li.id, `${li.description ?? 'Line item'}${dims}${qty}`)
      lineItemQty.set(li.id, Math.max(1, Number(li.quantity ?? 1)))
    }
  }

  // QR code
  const scanUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://printos-lemon.vercel.app'}/dashboard/${slug}/jobs/${jobId}/scan`
  let qrDataUrl = ''
  try {
    qrDataUrl = await generateQRDataUrl(scanUrl)
  } catch { /* QR generation optional */ }

  // Workflow progress
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

      {/* Phase Dates */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Phase Dates</h2>
        <form action={updateJobPhaseDates}>
          <input type="hidden" name="jobId"   value={job.id} />
          <input type="hidden" name="orgId"   value={org.id} />
          <input type="hidden" name="orgSlug" value={slug} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Production Due</label>
              <input
                type="date"
                name="production_due_date"
                defaultValue={job.production_due_date ?? ''}
                className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            {(job.department?.includes('fabrication') || job.fabrication_due_date) && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Fabrication Due</label>
                <input
                  type="date"
                  name="fabrication_due_date"
                  defaultValue={job.fabrication_due_date ?? ''}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>
            )}
            {(job.department?.includes('installation') || job.installation_due_date) && (
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Installation Date</label>
                <input
                  type="date"
                  name="installation_due_date"
                  defaultValue={job.installation_due_date ?? ''}
                  className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>
            )}
          </div>
          <button type="submit" className="mt-4 rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
            Save Dates
          </button>
        </form>
      </div>

      {/* Workflow Steps checklist — only shown when the job has flagged steps */}
      {workflowSteps.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <WorkflowChecklist
            jobId={job.id}
            orgId={org.id}
            steps={workflowSteps}
            progress={workflowProgress}
          />
        </div>
      )}

      {/* Production Setup — output of the Smart Material Selection Engine.
          One card per quote line item that resolved to a roll material. */}
      {materialLines.length > 0 && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Production Setup</h2>
            {job.assigned_printer && (
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                  job.assigned_printer === 'Swiss Q'
                    ? 'bg-qm-fuchsia text-white'
                    : 'bg-[#1A1A1A] text-white'
                }`}
                title="Job-level printer routing (first roll-material line item)"
              >
                {job.assigned_printer}
              </span>
            )}
          </div>
          <div className="space-y-3">
            {materialLines.map((line) => {
              const label = lineItemLabels.get(line.line_item_id) ?? 'Line item'
              if (line.no_material_found) {
                return (
                  <div key={line.line_item_id} className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">{label}</p>
                    <p className="mt-1 text-sm text-amber-800">No roll material matched — {line.reason ?? 'check the product recipe.'}</p>
                  </div>
                )
              }
              const qty = lineItemQty.get(line.line_item_id) ?? 1
              const twoUpSqft = line.two_up_candidate && line.two_up_roll_width
                ? (line.two_up_roll_width / 12) * (line.actual_print_height / 12) * Math.ceil(qty / 2)
                : 0
              const twoUpSavedSqft = Math.max(0, line.material_used_sqft - twoUpSqft)
              return (
                <div key={line.line_item_id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
                    {line.assigned_printer && (
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                          line.assigned_printer === 'Swiss Q' ? 'bg-qm-fuchsia text-white' : 'bg-[#1A1A1A] text-white'
                        }`}
                      >
                        {line.assigned_printer}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-gray-900">
                    Load {line.roll_width_inches}″ {line.selected_material_name}
                  </p>
                  <p className="mt-1 text-xs text-gray-600">
                    Print length: {line.actual_print_height}″ — Material used: <span className="font-semibold tabular-nums">{line.material_used_sqft.toFixed(2)} sq ft</span>
                    {line.hem_allowance_applied && <span className="ml-2 text-gray-400">(includes hem allowance)</span>}
                  </p>
                  {line.two_up_candidate && line.two_up_roll_width && (
                    <p className="mt-2 inline-block rounded-md bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                      2-up opportunity: fits on {line.two_up_roll_width}″ roll{twoUpSavedSqft > 0 ? ` — saves ${twoUpSavedSqft.toFixed(2)} sq ft` : ''}
                    </p>
                  )}
                  {line.low_stock_warning && line.low_stock_message && (
                    <p className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                      ⚠ {line.low_stock_message}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

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
          <form action={uploadProof}>
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="orgSlug" value={slug} />
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

        {/* Proof Versions */}
        {proofs.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Proof Versions</h2>
            </div>
            <div className="divide-y divide-gray-100">
              {proofs.map((proof) => (
                <div key={proof.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
                      v{proof.version_number}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{proof.file_name}</p>
                      <p className="text-xs text-gray-500">
                        {new Date(proof.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${proofStatusStyles[proof.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {proof.status}
                    </span>
                    <a href={proof.file_url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-qm-fuchsia hover:underline">
                      Download
                    </a>
                    {proof.status === 'pending' && (
                      <>
                        <form action={updateProofStatus} className="inline">
                          <input type="hidden" name="proofId" value={proof.id} />
                          <input type="hidden" name="jobId" value={jobId} />
                          <input type="hidden" name="orgId" value={org.id} />
                          <input type="hidden" name="orgSlug" value={slug} />
                          <input type="hidden" name="status" value="approved" />
                          <button type="submit" className="rounded px-2 py-1 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100">
                            Approve
                          </button>
                        </form>
                        <form action={updateProofStatus} className="inline">
                          <input type="hidden" name="proofId" value={proof.id} />
                          <input type="hidden" name="jobId" value={jobId} />
                          <input type="hidden" name="orgId" value={org.id} />
                          <input type="hidden" name="orgSlug" value={slug} />
                          <input type="hidden" name="status" value="rejected" />
                          <button type="submit" className="rounded px-2 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100">
                            Reject
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* QR Code + Time Log */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* QR Code */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm text-center">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Time Tracking QR Code</h2>
          {qrDataUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="Scan to clock in/out" className="mx-auto h-48 w-48" />
              <p className="mt-2 text-xs text-gray-400">Scan to clock in/out on mobile</p>
              <a
                href={`/dashboard/${slug}/jobs/${jobId}/scan`}
                className="mt-3 inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Open Scan Page
              </a>
            </>
          ) : (
            <a
              href={`/dashboard/${slug}/jobs/${jobId}/scan`}
              className="inline-block rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              Open Scan Page
            </a>
          )}
        </div>

        {/* Time Log */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Time Log</h2>
            <span className="text-sm font-semibold text-gray-700">
              Total: {totalHrs > 0 ? `${totalHrs}h ` : ''}{totalMins}m
            </span>
          </div>
          {timeLogs.length === 0 ? (
            <p className="text-sm text-gray-400">No time entries yet.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {timeLogs.map((log) => (
                <div key={log.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-full ${log.action === 'clock_in' ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-sm font-medium text-gray-700">
                      {log.action === 'clock_in' ? 'Clock In' : 'Clock Out'}
                    </span>
                    {log.duration_minutes != null && (
                      <span className="text-xs text-gray-400">({Number(log.duration_minutes).toFixed(0)} min)</span>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">
                      {new Date(log.scanned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                      {new Date(log.scanned_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                    {log.stage && <p className="text-xs text-gray-400">{STATUS_LABELS[log.stage] ?? log.stage}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
