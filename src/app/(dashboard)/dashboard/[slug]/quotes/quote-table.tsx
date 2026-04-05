'use client'

import { useState, useTransition } from 'react'
import { updateQuoteStatus } from './actions'
import type { QuoteStatus } from '@/types/database'

export type QuoteRow = {
  id: string
  quote_number: number
  title: string
  status: QuoteStatus
  created_at: string
  total: number // cents
  customer: {
    first_name: string
    last_name: string
    company_name: string | null
  } | null
}

const STATUS_STYLES: Record<QuoteStatus, string> = {
  draft:    'bg-qm-gray-light text-qm-gray',
  sent:     'bg-qm-fuchsia-light text-qm-fuchsia',
  approved: 'bg-qm-lime-light text-qm-lime',
  declined: 'bg-red-50 text-red-700',
}

const STATUS_OPTIONS: { value: QuoteStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function QuoteTable({
  quotes,
  orgId,
  orgSlug,
}: {
  quotes: QuoteRow[]
  orgId: string
  orgSlug: string
}) {
  const [rows, setRows] = useState(quotes)
  const [, startTransition] = useTransition()

  function handleStatusChange(quoteId: string, newStatus: QuoteStatus) {
    const prev = rows
    setRows((r) => r.map((q) => (q.id === quoteId ? { ...q, status: newStatus } : q)))

    startTransition(async () => {
      const result = await updateQuoteStatus(quoteId, orgId, orgSlug, newStatus)
      if (result.error) {
        setRows(prev) // revert on error
      }
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              #
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Title
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Customer
            </th>
            <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
              Total
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Status
            </th>
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Created
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((quote) => (
            <tr key={quote.id} className="hover:bg-gray-50">
              <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-500">
                Q-{quote.quote_number}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                {quote.title}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                {quote.customer
                  ? `${quote.customer.first_name} ${quote.customer.last_name}${quote.customer.company_name ? ` (${quote.customer.company_name})` : ''}`
                  : <span className="text-gray-300">—</span>}
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900 text-right font-medium">
                ${formatCents(quote.total)}
              </td>
              <td className="whitespace-nowrap px-6 py-4">
                <select
                  value={quote.status}
                  onChange={(e) => handleStatusChange(quote.id, e.target.value as QuoteStatus)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize border-0 cursor-pointer ${STATUS_STYLES[quote.status]}`}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </td>
              <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                {formatDate(quote.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
