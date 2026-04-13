'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { SalesOrderStatus, JobStatus } from '@/types/database'
import { updateSalesOrderStatus } from '../actions'
import {
  formatSoNumber,
  formatCents,
  SO_STATUS_STYLES,
  SO_STATUS_LABELS,
} from '../format'

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: 'New',
  in_progress: 'In Progress',
  proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup',
  completed: 'Completed',
}

const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  new: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-50 text-blue-700',
  proof_review: 'bg-amber-50 text-amber-700',
  ready_for_pickup: 'bg-teal-50 text-teal-700',
  completed: 'bg-green-50 text-green-700',
}

type SalesOrder = {
  id: string
  so_number: number
  title: string
  status: SalesOrderStatus
  total: number
  notes: string | null
  created_at: string
  updated_at: string
  customer: {
    first_name: string
    last_name: string
    company_name: string | null
    email: string | null
    phone: string | null
  } | null
}

type QuoteRef = {
  id: string
  quote_number: number
  title: string
  created_at: string
}

type Job = {
  id: string
  job_number: number
  title: string
  status: JobStatus
  due_date: string | null
}

type Props = {
  orgId: string
  orgSlug: string
  salesOrder: SalesOrder
  parentQuote: QuoteRef | null
  jobs: Job[]
}

const MANUAL_STATUSES: { value: SalesOrderStatus; label: string }[] = [
  { value: 'hold', label: 'Hold' },
  { value: 'no_charge', label: 'No Charge' },
  { value: 'no_charge_approved', label: 'No Charge Approved' },
  { value: 'void', label: 'Void' },
]

function formatQuoteNumber(num: number, createdAtIso: string): string {
  const year = new Date(createdAtIso).getFullYear()
  return `Q-${year}-${String(num).padStart(4, '0')}`
}

export default function SoDetailClient({
  orgId, orgSlug, salesOrder, parentQuote, jobs,
}: Props) {
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<SalesOrderStatus>(salesOrder.status)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  function flash(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  function handleStatusChange(next: SalesOrderStatus) {
    const prev = status
    setStatus(next)
    startTransition(async () => {
      const res = await updateSalesOrderStatus(salesOrder.id, orgId, orgSlug, next)
      if (res.error) {
        setStatus(prev)
        flash(res.error, 'error')
      } else {
        flash(`Status updated to ${SO_STATUS_LABELS[next]}`)
      }
    })
  }

  const customerName = salesOrder.customer
    ? `${salesOrder.customer.first_name} ${salesOrder.customer.last_name}`
    : null
  const companyName = salesOrder.customer?.company_name

  return (
    <>
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg ${
          toast.type === 'success'
            ? 'border-green-200 bg-green-50 text-green-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Header card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
              {formatSoNumber(salesOrder.so_number, salesOrder.created_at)}
            </p>
            <h1 className="mt-1 text-2xl font-extrabold text-gray-900">
              {salesOrder.title || 'Untitled Sales Order'}
            </h1>
            {customerName ? (
              <p className="mt-1 text-sm text-gray-600">
                {customerName}
                {companyName && <span className="text-gray-400"> &mdash; {companyName}</span>}
              </p>
            ) : (
              <p className="mt-1 text-sm text-gray-400">No customer linked</p>
            )}
          </div>
          <div className="text-right">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${SO_STATUS_STYLES[status]}`}>
              {SO_STATUS_LABELS[status]}
            </span>
            <p className="mt-2 text-xs text-gray-500">
              Created {new Date(salesOrder.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
        </div>

        {/* Details grid */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Total</span>
            <span className="mt-1 block text-lg font-extrabold tabular-nums text-gray-900">
              ${formatCents(salesOrder.total)}
            </span>
          </div>
          {parentQuote && (
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">From Quote</span>
              <Link
                href={`/dashboard/${orgSlug}/quotes/${parentQuote.id}`}
                className="mt-1 block text-sm font-semibold text-qm-fuchsia hover:underline"
              >
                {formatQuoteNumber(parentQuote.quote_number, parentQuote.created_at)} &mdash; {parentQuote.title}
              </Link>
            </div>
          )}
          {salesOrder.customer?.email && (
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Email</span>
              <span className="mt-1 block text-sm text-gray-700">{salesOrder.customer.email}</span>
            </div>
          )}
        </div>

        {salesOrder.notes && (
          <div className="mt-4">
            <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Notes</span>
            <p className="mt-1 text-sm text-gray-700">{salesOrder.notes}</p>
          </div>
        )}

        {/* Manual status actions */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {MANUAL_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => handleStatusChange(s.value)}
              disabled={isPending || status === s.value}
              className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                status === s.value
                  ? 'border-gray-300 bg-gray-100 text-gray-500'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Child jobs */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-bold text-gray-900">Jobs</h2>
        </div>

        {jobs.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No jobs created yet. Jobs are created automatically when a quote is approved.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">#</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Title</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium">
                      <Link
                        href={`/dashboard/${orgSlug}/jobs/${job.id}`}
                        className="text-qm-fuchsia hover:underline"
                      >
                        JOB-{String(job.job_number).padStart(4, '0')}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                      {job.title}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${JOB_STATUS_STYLES[job.status]}`}>
                        {JOB_STATUS_LABELS[job.status]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {job.due_date
                        ? new Date(job.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : <span className="text-gray-300">&mdash;</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
