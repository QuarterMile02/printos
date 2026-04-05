'use client'

import { useTransition, useState } from 'react'
import { updateJobStatus } from './actions'
import type { JobStatus } from '@/types/database'

export type JobCard = {
  id: string
  job_number: number
  title: string
  status: JobStatus
  due_date: string | null
  customer: {
    first_name: string
    last_name: string
    company_name: string | null
  } | null
}

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

type CardProps = {
  job: JobCard
  orgId: string
  orgSlug: string
}

function JobCardItem({ job, orgId, orgSlug }: CardProps) {
  const [isPending, startTransition] = useTransition()
  const [optimisticStatus, setOptimisticStatus] = useState<JobStatus>(job.status)

  function handleStatusChange(next: JobStatus) {
    setOptimisticStatus(next)
    startTransition(async () => {
      const result = await updateJobStatus(job.id, orgId, orgSlug, next)
      if (result.error) {
        // revert on error
        setOptimisticStatus(job.status)
      }
    })
  }

  const overdue = job.due_date ? isOverdue(job.due_date, optimisticStatus) : false

  return (
    <div className={`rounded-lg border bg-white p-3 shadow-sm transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      {/* Job number + due date */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-400">#{job.job_number}</span>
        {job.due_date && (
          <span className={`text-xs font-medium ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
            {overdue ? 'Overdue · ' : ''}{formatDueDate(job.due_date)}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-gray-900 leading-snug mb-2">{job.title}</p>

      {/* Customer */}
      {job.customer && (
        <p className="text-xs text-gray-500 mb-3">
          {job.customer.first_name} {job.customer.last_name}
          {job.customer.company_name && (
            <span className="text-gray-400"> · {job.customer.company_name}</span>
          )}
        </p>
      )}

      {/* Status selector */}
      <select
        value={optimisticStatus}
        disabled={isPending}
        onChange={(e) => handleStatusChange(e.target.value as JobStatus)}
        className="mt-1 w-full rounded border border-gray-200 bg-qm-surface px-2 py-1 text-xs text-qm-black focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime disabled:opacity-50"
      >
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </div>
  )
}

type Props = {
  jobs: JobCard[]
  orgId: string
  orgSlug: string
}

export default function KanbanBoard({ jobs, orgId, orgSlug }: Props) {
  return (
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
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
