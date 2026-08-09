import { createClient, createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { updateJobPhaseDates } from '../../jobs/actions'
import { generateQRDataUrl } from '@/lib/qr'
import DepartmentSelect from '../../jobs/[jobId]/department-select'
import WorkflowChecklist, { type WorkflowStep, type WorkflowProgress } from '../../jobs/[jobId]/workflow-checklist'
import { checkPermission } from '@/lib/check-permission'
import TasksTab from '@/components/tasks/TasksTab'
import { dbOrThrow } from '@/lib/db'

const STATUS_LABELS: Record<string, string> = {
  new: 'New', in_progress: 'In Progress', proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup', completed: 'Completed',
  on_hold: 'On Hold', pending_approval: 'Pending Approval',
}
const STATUS_STYLES: Record<string, string> = {
  new: 'bg-gray-100 text-gray-700', in_progress: 'bg-blue-50 text-blue-700',
  proof_review: 'bg-amber-50 text-amber-700', ready_for_pickup: 'bg-teal-50 text-teal-700',
  completed: 'bg-green-50 text-green-700', on_hold: 'bg-gray-200 text-gray-700',
  pending_approval: 'bg-amber-50 text-amber-700',
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type Props = {
  jobId: string
  orgId: string
  orgSlug: string
  // The standalone job page (jobs/[jobId]/page.tsx) already renders its
  // own richer header (title, status, flag, due date, department select,
  // customer picker) above this panel -- showing the compact header below
  // too would just repeat the same handful of fields a second time on
  // that page. The Sales Order page's row has no such header of its own
  // (only a one-line status pill + due date at the collapsed-row level),
  // so it needs this. Default true since the SO page is the primary
  // caller; the standalone job page explicitly passes false.
  showHeader?: boolean
}

// Item: SO detail page unified list — the job/work-order detail shown
// when a line item's row is expanded. This is the SAME body content the
// standalone job page (jobs/[jobId]/page.tsx) renders for a job, factored
// out here so both callers share one implementation instead of drifting
// apart. jobs/[jobId]/page.tsx renders this for its own body; it only
// keeps its page-specific chrome (breadcrumb, title/customer-picker
// header, its own "Upload Proof" form with the line-item dropdown) on top.
//
// Deliberately does NOT include an upload-proof form of its own -- the SO
// page already has a simpler, line-item-scoped uploader (ProofUploadRow /
// UploadProofButton) that doesn't need a dropdown since the row it's
// rendered from already tells you which line item it's for. The
// standalone job page keeps its own dropdown-based uploader alongside
// this panel, since a job reached directly (especially a pre-121 legacy
// job covering a whole SO) may still need to pick which line item a new
// proof belongs to.
export default async function JobDetailPanel({ jobId, orgId, orgSlug, showHeader = true }: Props) {
  const supabase = await createClient()
  const service = createServiceClient()

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
    source_quote_id: string | null; quote_line_item_id: string | null; assigned_to: string | null
    material_selection: { line_items?: MaterialLine[]; computed_at?: string } | null
    assigned_printer: string | null
    department: string | null
    production_due_date: string | null
    fabrication_due_date: string | null
    installation_due_date: string | null
  }

  let job: JobShape | null = null
  const fullSelect = 'id, job_number, title, description, status, flag, due_date, source_quote_id, quote_line_item_id, assigned_to, material_selection, assigned_printer, department, production_due_date, fabrication_due_date, installation_due_date'
  const { data: jobRow1, error: jobErr1 } = await supabase
    .from('jobs')
    .select(fullSelect)
    .eq('id', jobId)
    .eq('organization_id', orgId)
    .single()
  if (jobRow1) {
    job = jobRow1 as unknown as JobShape
  } else if (jobErr1?.message?.includes('does not exist')) {
    const { data: jobRow2 } = await supabase
      .from('jobs')
      .select('id, job_number, title, description, status, flag, due_date, source_quote_id, assigned_to')
      .eq('id', jobId)
      .eq('organization_id', orgId)
      .single()
    if (jobRow2) job = { ...(jobRow2 as unknown as Omit<JobShape, 'quote_line_item_id' | 'material_selection' | 'assigned_printer' | 'department' | 'production_due_date' | 'fabrication_due_date' | 'installation_due_date'>), quote_line_item_id: null, material_selection: null, assigned_printer: null, department: null, production_due_date: null, fabrication_due_date: null, installation_due_date: null }
  }
  if (!job) return <div className="p-4 text-sm text-red-600">Job not found.</div>

  const { allowed: canAssignDepartment } = await checkPermission(orgId, 'jobs.assign_department')

  // Assigned team member name
  let assignedName: string | null = null
  if (job.assigned_to) {
    const profile = await dbOrThrow(
      supabase.from('profiles').select('full_name, email').eq('id', job.assigned_to).maybeSingle()
    )
    const p = profile as { full_name: string | null; email: string } | null
    assignedName = p?.full_name || p?.email || null
  }

  // Source quote (for the header link)
  let sourceQuoteNum: number | null = null
  if (job.source_quote_id) {
    const q = await dbOrThrow(
      supabase.from('quotes').select('quote_number').eq('id', job.source_quote_id).maybeSingle()
    )
    sourceQuoteNum = (q as { quote_number: number } | null)?.quote_number ?? null
  }

  // Workflow steps + progress
  const workflowSteps: WorkflowStep[] = []
  const workflowProgress: WorkflowProgress[] = []
  if (job.source_quote_id) {
    type LiProd = { product_id: string | null }
    let liQuery = service
      .from('quote_line_items')
      .select('product_id')
      .eq('quote_id', job.source_quote_id)
      .not('product_id', 'is', null)
    if (job.quote_line_item_id) liQuery = liQuery.eq('id', job.quote_line_item_id)
    const liRows = await dbOrThrow(liQuery) as LiProd[] | null

    const productIds = [...new Set((liRows ?? []).map((r) => r.product_id).filter(Boolean) as string[])]

    if (productIds.length > 0) {
      type PdiRow = {
        id: string; item_type: string; custom_item_name: string | null; sort_order: number
        materials: { name: string } | null
        labor_rates: { name: string } | null
        machine_rates: { name: string } | null
      }
      const pdiRows = await dbOrThrow(
        service
          .from('product_default_items')
          .select('id, item_type, custom_item_name, sort_order, materials(name), labor_rates(name), machine_rates(name)')
          .in('product_id', productIds)
          .eq('workflow_step', true)
          .order('sort_order')
      ) as PdiRow[] | null

      for (const r of pdiRows ?? []) {
        let name = r.custom_item_name
        if (!name && r.item_type === 'Material')    name = r.materials?.name ?? null
        if (!name && r.item_type === 'LaborRate')   name = r.labor_rates?.name ?? null
        if (!name && r.item_type === 'MachineRate') name = r.machine_rates?.name ?? null
        workflowSteps.push({ id: r.id, name: name ?? 'Step', sortOrder: r.sort_order })
      }
    }

    type ProgRow = { step_name: string; checked_by: string | null; checked_at: string | null }
    const progRows = await dbOrThrow(
      service.from('jobs_workflow_progress').select('step_name, checked_by, checked_at').eq('job_id', jobId)
    ) as ProgRow[] | null

    const checkerIds = [...new Set((progRows ?? []).map((p) => p.checked_by).filter(Boolean) as string[])]
    const nameMap = new Map<string, string>()
    if (checkerIds.length > 0) {
      const profiles = await dbOrThrow(
        service.from('profiles').select('id, full_name').in('id', checkerIds)
      ) as { id: string; full_name: string | null }[] | null
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

  // Proof versions (full history — the row-level state outside this panel
  // already shows the latest ready/responded proof; this is the full list)
  const proofRows = await dbOrThrow(
    supabase
      .from('proof_versions')
      .select('id, file_url, file_name, version_number, status, created_at, quote_line_item_id, customer_feedback, customer_responded_at')
      .eq('job_id', jobId)
      .order('version_number', { ascending: false })
  )
  const proofs = (proofRows ?? []) as {
    id: string; file_url: string; file_name: string; version_number: number
    status: string; created_at: string
    quote_line_item_id: string | null; customer_feedback: string | null; customer_responded_at: string | null
  }[]

  let proofLineItemLabelById = new Map<string, string>()
  if (job.source_quote_id) {
    type ProofLineItemOption = { id: string; description: string | null; width: number | null; height: number | null; quantity: number | null }
    let liOptQuery = supabase
      .from('quote_line_items')
      .select('id, description, width, height, quantity')
      .eq('quote_id', job.source_quote_id)
      .order('sort_order')
    if (job.quote_line_item_id) liOptQuery = liOptQuery.eq('id', job.quote_line_item_id)
    const liOptRows = await dbOrThrow(liOptQuery) as ProofLineItemOption[] | null
    proofLineItemLabelById = new Map((liOptRows ?? []).map((li) => {
      const dims = li.width != null && li.height != null ? ` ${li.width}″×${li.height}″` : ''
      const qty = li.quantity != null && li.quantity !== 1 ? ` × ${li.quantity}` : ''
      return [li.id, `${li.description ?? 'Line item'}${dims}${qty}`]
    }))
  }

  const proofStatusStyles: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700',
    approved: 'bg-green-50 text-green-700',
    rejected: 'bg-red-50 text-red-700',
  }

  // Time logs
  const timeLogRows = await dbOrThrow(
    supabase
      .from('job_time_logs')
      .select('id, action, stage, duration_minutes, scanned_at, user_id')
      .eq('job_id', jobId)
      .order('scanned_at', { ascending: false })
  )
  const timeLogs = (timeLogRows ?? []) as {
    id: string; action: string; stage: string | null; duration_minutes: number | null
    scanned_at: string; user_id: string | null
  }[]
  const totalMinutes = timeLogs
    .filter(l => l.duration_minutes)
    .reduce((sum, l) => sum + Number(l.duration_minutes ?? 0), 0)
  const totalHrs = Math.floor(totalMinutes / 60)
  const totalMins = Math.round(totalMinutes % 60)

  // Material line labels for Production Setup
  const materialLines = job.material_selection?.line_items ?? []
  const lineItemLabels = new Map<string, string>()
  const lineItemQty = new Map<string, number>()
  if (materialLines.length > 0 && job.source_quote_id) {
    type LiRow = { id: string; description: string | null; width: number | null; height: number | null; quantity: number | null }
    const liRows = await dbOrThrow(
      supabase
        .from('quote_line_items')
        .select('id, description, width, height, quantity')
        .in('id', materialLines.map((l) => l.line_item_id))
    ) as LiRow[] | null
    for (const li of liRows ?? []) {
      const dims = li.width != null && li.height != null ? ` ${li.width}″×${li.height}″` : ''
      const qty = li.quantity != null && li.quantity !== 1 ? ` × ${li.quantity}` : ''
      lineItemLabels.set(li.id, `${li.description ?? 'Line item'}${dims}${qty}`)
      lineItemQty.set(li.id, Math.max(1, Number(li.quantity ?? 1)))
    }
  }

  // QR code
  const scanUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://printos-lemon.vercel.app'}/dashboard/${orgSlug}/jobs/${jobId}/scan`
  let qrDataUrl = ''
  try { qrDataUrl = await generateQRDataUrl(scanUrl) } catch { /* QR generation optional */ }

  const statusOrder = ['new', 'in_progress', 'proof_review', 'ready_for_pickup', 'completed']
  const currentIdx = statusOrder.indexOf(job.status)

  return (
    <div className="space-y-6">
      {showHeader && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-gray-900">JOB-{String(job.job_number).padStart(4, '0')}</span>
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[job.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {STATUS_LABELS[job.status] ?? job.status}
            </span>
            {job.flag && (
              <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${job.flag === 'file_error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                {job.flag === 'file_error' ? 'File Error' : 'Help Needed'}
              </span>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-6 text-sm">
            {job.due_date && (
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Due </span>
                <span className="text-gray-700 font-semibold">{fmtDate(job.due_date)}</span>
              </div>
            )}
            {assignedName && (
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Assigned To </span>
                <span className="text-gray-700">{assignedName}</span>
              </div>
            )}
            {job.source_quote_id && sourceQuoteNum && (
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Quote </span>
                <Link href={`/dashboard/${orgSlug}/quotes/${job.source_quote_id}`} className="text-qm-fuchsia hover:underline font-semibold">
                  Q-{String(sourceQuoteNum).padStart(4, '0')}
                </Link>
              </div>
            )}
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1">Department</span>
              <DepartmentSelect
                jobId={job.id}
                orgId={orgId}
                orgSlug={orgSlug}
                currentDepartment={job.department}
                canAssign={canAssignDepartment}
              />
            </div>
          </div>
        </div>
      )}

      {/* Workflow Progress */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Workflow Progress</h3>
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
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Phase Dates</h3>
        <form action={updateJobPhaseDates}>
          <input type="hidden" name="jobId"   value={job.id} />
          <input type="hidden" name="orgId"   value={orgId} />
          <input type="hidden" name="orgSlug" value={orgSlug} />
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

      {workflowSteps.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <WorkflowChecklist jobId={job.id} orgId={orgId} steps={workflowSteps} progress={workflowProgress} />
        </div>
      )}

      {materialLines.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Production Setup</h3>
            {job.assigned_printer && (
              <span
                className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
                  job.assigned_printer === 'Swiss Q' ? 'bg-qm-fuchsia text-white' : 'bg-[#1A1A1A] text-white'
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

      {/* Production Notes */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Production Notes</h3>
        {job.description ? (
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{job.description}</p>
        ) : (
          <p className="text-sm text-gray-400">No production notes.</p>
        )}
      </div>

      {/* Proof Versions */}
      {proofs.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-4 py-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Proof Versions</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {proofs.map((proof) => (
              <div key={proof.id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-xs font-bold text-gray-600">
                    v{proof.version_number}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{proof.file_name}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(proof.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {proof.quote_line_item_id && (
                        <span className="ml-2 text-gray-400">· {proofLineItemLabelById.get(proof.quote_line_item_id) ?? 'Line item'}</span>
                      )}
                    </p>
                    {proof.customer_feedback && (
                      <p className="mt-1 max-w-md text-xs italic text-gray-600">
                        “{proof.customer_feedback}”
                        {proof.customer_responded_at && (
                          <span className="not-italic text-gray-400"> — customer, {new Date(proof.customer_responded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${proofStatusStyles[proof.status] ?? 'bg-gray-100 text-gray-700'}`}>
                  {proof.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <TasksTab jobId={job.id} />
      </div>

      {/* QR Code + Time Log */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Time Tracking QR Code</h3>
          {qrDataUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="Scan to clock in/out" className="mx-auto h-36 w-36" />
              <p className="mt-2 text-xs text-gray-400">Scan to clock in/out on mobile</p>
            </>
          ) : null}
          <a
            href={`/dashboard/${orgSlug}/jobs/${jobId}/scan`}
            className="mt-3 inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Open Scan Page
          </a>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Time Log</h3>
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
