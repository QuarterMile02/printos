'use client'

import { useTransition, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateJobStatus } from './actions'
import type { JobStatus, JobFlag } from '@/types/database'

export type JobCard = {
  id: string
  job_number: number
  title: string
  status: JobStatus
  flag: JobFlag | null
  due_date: string | null
  customer: {
    first_name: string
    last_name: string
    company_name: string | null
  } | null
  product_name: string | null
  width: number | null
  height: number | null
  quantity: number | null
  assigned_initials: string | null
  department: string | null
}

type DeptOption = { code: string; name: string }

type Column = {
  status: JobStatus
  label: string
  headerClass: string
  dotClass: string
}

const COLUMNS: Column[] = [
  {
    status: 'new',
    label: 'New',
    headerClass: 'bg-qm-lime-light text-qm-lime',
    dotClass: 'bg-qm-lime',
  },
  {
    status: 'in_progress',
    label: 'In Progress',
    headerClass: 'bg-qm-fuchsia-light text-qm-fuchsia',
    dotClass: 'bg-qm-fuchsia',
  },
  {
    status: 'proof_review',
    label: 'Proof Review',
    headerClass: 'bg-qm-gray-light text-qm-gray',
    dotClass: 'bg-qm-gray',
  },
  {
    status: 'ready_for_pickup',
    label: 'Ready for Pickup',
    headerClass: 'bg-qm-black/5 text-qm-black',
    dotClass: 'bg-qm-black',
  },
  {
    status: 'completed',
    label: 'Completed',
    headerClass: 'bg-qm-lime-light text-qm-lime',
    dotClass: 'bg-qm-lime',
  },
]

const STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'proof_review', label: 'Proof Review' },
  { value: 'ready_for_pickup', label: 'Ready for Pickup' },
  { value: 'completed', label: 'Completed' },
]

function formatDueDate(iso: string): string {
  // iso is a date string like "2026-04-15"
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function isOverdue(dueDate: string, status: JobStatus): boolean {
  if (status === 'completed') return false
  const [year, month, day] = dueDate.split('-').map(Number)
  const due = new Date(year, month - 1, day)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}

function isDueSoon(dueDate: string, status: JobStatus): boolean {
  if (status === 'completed') return false
  const [year, month, day] = dueDate.split('-').map(Number)
  const due = new Date(year, month - 1, day)
  const now = new Date()
  const diff = due.getTime() - now.getTime()
  return diff >= 0 && diff <= 24 * 60 * 60 * 1000
}

type CardProps = {
  job: JobCard
  orgId: string
  orgSlug: string
  printMode: boolean
  selected: boolean
  onToggleSelect: (id: string) => void
}

function JobCardItem({ job, orgId, orgSlug, onNotified, printMode, selected, onToggleSelect }: CardProps & { onNotified: (msg: string) => void }) {
  const [isPending, startTransition] = useTransition()
  const [optimisticStatus, setOptimisticStatus] = useState<JobStatus>(job.status)

  function handleStatusChange(next: JobStatus) {
    setOptimisticStatus(next)
    startTransition(async () => {
      const result = await updateJobStatus(job.id, orgId, orgSlug, next)
      if (result.error) {
        setOptimisticStatus(job.status)
      } else if (result.notified) {
        onNotified(`Customer notified — Job #${result.notified} ready for pickup`)
      }
    })
  }

  const overdue = job.due_date ? isOverdue(job.due_date, optimisticStatus) : false
  const dueSoon = job.due_date ? isDueSoon(job.due_date, optimisticStatus) : false

  const isFileError  = job.flag === 'file_error'
  const isHelpNeeded = job.flag === 'help_needed'
  const isCompleted  = optimisticStatus === 'completed'

  let borderClass = 'border'
  if (isFileError) borderClass = 'border-2 border-red-500 animate-pulse'
  else if (isHelpNeeded) borderClass = 'border-2 border-amber-500'
  else if (dueSoon) borderClass = 'border-2 border-amber-500'
  else if (isCompleted) borderClass = 'border-2 border-green-400'

  const detailHref = `/dashboard/${orgSlug}/jobs/${job.id}`

  const dueDateStyle = overdue
    ? 'bg-red-50 text-red-700'
    : dueSoon
      ? 'bg-amber-50 text-amber-700'
      : 'bg-gray-50 text-gray-500'

  // ── Print-mode: selectable card, no navigation ───────────────────────────────
  if (printMode) {
    return (
      <div
        onClick={() => onToggleSelect(job.id)}
        className={`cursor-pointer select-none rounded-lg ${borderClass} bg-white p-3 shadow-sm transition-all
          ${selected ? 'ring-2 ring-qm-lime ring-offset-1' : 'hover:shadow-md'}`}
      >
        <div className="flex items-start justify-between mb-1.5">
          <span className="text-xs font-semibold text-gray-400">#{job.job_number}</span>
          <input
            type="checkbox"
            checked={selected}
            readOnly
            className="h-4 w-4 rounded border-gray-300 accent-qm-lime pointer-events-none"
          />
        </div>
        <p className="text-sm font-medium text-gray-900 leading-snug mb-1">{job.title}</p>
        {job.customer && (
          <p className="text-xs text-gray-500">
            {job.customer.first_name} {job.customer.last_name}
            {job.customer.company_name && (
              <span className="text-gray-400"> &middot; {job.customer.company_name}</span>
            )}
          </p>
        )}
        {job.due_date && (
          <div className={`mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${dueDateStyle}`}>
            {overdue ? 'Overdue' : dueSoon ? 'Due today' : formatDueDate(job.due_date)}
          </div>
        )}
      </div>
    )
  }

  // ── Normal mode ───────────────────────────────────────────────────────────────
  return (
    <a href={detailHref} className={`block rounded-lg ${borderClass} bg-white p-3 shadow-sm transition-all hover:shadow-md ${isPending ? 'opacity-60' : ''}`}>
      {/* Top row: job number + assigned initials */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-gray-400">#{job.job_number}</span>
        <div className="flex items-center gap-1.5">
          {job.flag && (
            <span className={`inline-block h-2 w-2 rounded-full ${job.flag === 'file_error' ? 'bg-red-500 animate-pulse' : 'bg-amber-500'}`}
              title={job.flag === 'file_error' ? 'File Error' : 'Help Needed'} />
          )}
          {job.assigned_initials && (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-qm-lime-light text-xs font-bold text-qm-lime-dark" title="Assigned">
              {job.assigned_initials}
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-gray-900 leading-snug mb-1">{job.title}</p>

      {/* Product + dimensions */}
      {job.product_name && (
        <p className="text-xs text-gray-600 mb-1">
          {job.product_name}
          {job.width && job.height ? (
            <span className="text-gray-400"> &mdash; {job.width}&quot; &times; {job.height}&quot;</span>
          ) : null}
          {job.quantity && job.quantity > 1 ? (
            <span className="text-gray-400"> &times; {job.quantity}</span>
          ) : null}
        </p>
      )}

      {/* Customer */}
      {job.customer && (
        <p className="text-xs text-gray-500 mb-2">
          {job.customer.first_name} {job.customer.last_name}
          {job.customer.company_name && (
            <span className="text-gray-400"> &middot; {job.customer.company_name}</span>
          )}
        </p>
      )}

      {/* Due date badge */}
      {job.due_date && (
        <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${dueDateStyle}`}>
          {overdue && (
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          )}
          {overdue ? 'Overdue' : dueSoon ? 'Due today' : formatDueDate(job.due_date)}
        </div>
      )}

      {/* Status selector — stop propagation so clicking it doesn't navigate */}
      <select
        value={optimisticStatus}
        disabled={isPending}
        onChange={(e) => handleStatusChange(e.target.value as JobStatus)}
        onClick={(e) => e.preventDefault()}
        className="mt-2 w-full rounded border border-gray-200 bg-qm-surface px-2 py-1 text-xs text-qm-black focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime disabled:opacity-50"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </a>
  )
}

type Props = {
  jobs: JobCard[]
  orgId: string
  orgSlug: string
  allDepartments: DeptOption[]
  activeDepartments: string[] | null
  canChangeFilter: boolean
  canSeeAllDepartments: boolean
  currentFilter: string
}

export default function KanbanBoard({
  jobs, orgId, orgSlug,
  allDepartments, activeDepartments, canChangeFilter, canSeeAllDepartments, currentFilter,
}: Props) {
  const router = useRouter()
  const [toast, setToast] = useState<{ message: string; key: number } | null>(null)
  const [printMode, setPrintMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const deptLabelMap = new Map(allDepartments.map((d) => [d.code, d.name]))
  const activeLabels = activeDepartments
    ? activeDepartments.map((code) => deptLabelMap.get(code) ?? code)
    : []
  const filterIsActive = activeDepartments !== null && activeDepartments.length > 0

  function handleFilterChange(value: string) {
    const url = new URL(window.location.href)
    if (!value || value === 'all') {
      url.searchParams.delete('department')
    } else {
      url.searchParams.set('department', value)
    }
    router.push(url.pathname + url.search)
  }

  function showToast(message: string) {
    setToast({ message, key: Date.now() })
    setTimeout(() => setToast(null), 5000)
  }

  function togglePrintMode() {
    setPrintMode((v) => !v)
    setSelectedIds(new Set())
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function printSelected() {
    const ids = [...selectedIds].join(',')
    window.open(`/api/jobs/labels?ids=${ids}`, '_blank')
  }

  return (
    <>
      {/* Toast notification */}
      {toast && (
        <div
          key={toast.key}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg"
        >
          <svg className="h-5 w-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span className="text-sm font-medium text-green-800">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 rounded p-0.5 text-green-600 hover:text-green-800">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Toolbar: department filter + print-mode toggle */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Print mode toggle */}
        <button
          onClick={togglePrintMode}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition
            ${printMode
              ? 'border-qm-lime bg-qm-lime-light text-qm-lime-dark'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
        >
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.054 48.054 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
          </svg>
          {printMode ? 'Exit Print Mode' : 'Print Labels'}
        </button>

        {printMode && (
          <span className="text-xs text-gray-500">
            Click cards to select, then print
          </span>
        )}
      </div>

      {/* Department filter bar */}
      {(filterIsActive || canChangeFilter) && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {filterIsActive && (
            <div className="inline-flex items-center gap-2 rounded-full border border-qm-lime bg-qm-lime-light px-3 py-1 text-xs font-semibold text-qm-lime-dark">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
              </svg>
              Showing: {activeLabels.join(', ')}
            </div>
          )}
          {canChangeFilter && (
            <select
              value={currentFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            >
              {canSeeAllDepartments && <option value="all">All Departments</option>}
              {allDepartments.map((d) => (
                <option key={d.code} value={d.code}>{d.name}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Floating print action bar */}
      {printMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-qm-lime bg-white px-5 py-3 shadow-xl">
          <span className="text-sm font-semibold text-gray-700">
            {selectedIds.size} job{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={printSelected}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-1.5 text-sm font-bold text-white shadow hover:brightness-105 transition"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.054 48.054 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
            </svg>
            Print {selectedIds.size} Label{selectedIds.size !== 1 ? 's' : ''}
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const colJobs = jobs.filter((j) => j.status === col.status)
          return (
            <div key={col.status} className="flex w-72 flex-shrink-0 flex-col gap-2">
              {/* Column header */}
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${col.headerClass}`}>
                <span className={`h-2 w-2 rounded-full ${col.dotClass}`} />
                <span className="text-xs font-semibold uppercase tracking-wide">{col.label}</span>
                <span className="ml-auto text-xs font-medium opacity-70">{colJobs.length}</span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 min-h-[4rem]">
                {colJobs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center">
                    <p className="text-xs text-gray-300">No jobs</p>
                  </div>
                ) : (
                  colJobs.map((job) => (
                    <JobCardItem
                      key={job.id}
                      job={job}
                      orgId={orgId}
                      orgSlug={orgSlug}
                      onNotified={showToast}
                      printMode={printMode}
                      selected={selectedIds.has(job.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
