'use client'

import { useState, useTransition } from 'react'
import { updateQuoteStatus, sendQuoteToCustomer } from './actions'
import type { QuoteStatus } from '@/types/database'
import type { DeliveryMethod } from './actions'

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
    email: string | null
    phone: string | null
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

function SendModal({
  quote,
  orgId,
  orgSlug,
  onClose,
  onSent,
}: {
  quote: QuoteRow
  orgId: string
  orgSlug: string
  onClose: () => void
  onSent: (message: string) => void
}) {
  const [method, setMethod] = useState<DeliveryMethod>('email')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const hasEmail = !!quote.customer?.email
  const hasPhone = !!quote.customer?.phone

  function handleSend() {
    setError(null)
    startTransition(async () => {
      const result = await sendQuoteToCustomer(quote.id, orgId, orgSlug, method)
      if (result.sent) {
        onClose()
        const methodLabel = method === 'both' ? 'email & SMS' : method
        onSent(`Quote #${quote.quote_number} sent via ${methodLabel}`)
      }
      if (result.error) {
        setError(result.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={() => !isPending && onClose()} />
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">Send Quote to Customer</h2>
        <p className="mt-1 text-sm text-gray-500">
          Q-{quote.quote_number} &middot; {quote.title} &middot; ${formatCents(quote.total)}
        </p>

        {quote.customer ? (
          <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
            <p className="font-medium text-gray-900">
              {quote.customer.first_name} {quote.customer.last_name}
            </p>
            {quote.customer.email && <p>Email: {quote.customer.email}</p>}
            {quote.customer.phone && <p>Phone: {quote.customer.phone}</p>}
            {!quote.customer.email && !quote.customer.phone && (
              <p className="text-amber-600">No email or phone on file.</p>
            )}
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            No customer linked to this quote.
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <fieldset className="mt-4 space-y-2" disabled={isPending}>
          <legend className="text-sm font-medium text-gray-700 mb-1">Delivery method</legend>

          <label className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${method === 'email' ? 'border-qm-lime bg-qm-lime-light' : 'border-gray-200 hover:bg-gray-50'} ${!hasEmail ? 'opacity-50' : ''}`}>
            <input
              type="radio"
              name="method"
              value="email"
              checked={method === 'email'}
              onChange={() => setMethod('email')}
              disabled={!hasEmail}
              className="accent-qm-lime"
            />
            <div>
              <span className="text-sm font-medium text-gray-900">Email</span>
              <p className="text-xs text-gray-500">
                {hasEmail ? `Send to ${quote.customer!.email}` : 'No email on file'}
              </p>
            </div>
          </label>

          <label className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${method === 'sms' ? 'border-qm-lime bg-qm-lime-light' : 'border-gray-200 hover:bg-gray-50'} ${!hasPhone ? 'opacity-50' : ''}`}>
            <input
              type="radio"
              name="method"
              value="sms"
              checked={method === 'sms'}
              onChange={() => setMethod('sms')}
              disabled={!hasPhone}
              className="accent-qm-lime"
            />
            <div>
              <span className="text-sm font-medium text-gray-900">SMS / Text</span>
              <p className="text-xs text-gray-500">
                {hasPhone ? `Send to ${quote.customer!.phone}` : 'No phone on file'}
              </p>
            </div>
          </label>

          <label className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${method === 'both' ? 'border-qm-lime bg-qm-lime-light' : 'border-gray-200 hover:bg-gray-50'} ${(!hasEmail || !hasPhone) ? 'opacity-50' : ''}`}>
            <input
              type="radio"
              name="method"
              value="both"
              checked={method === 'both'}
              onChange={() => setMethod('both')}
              disabled={!hasEmail || !hasPhone}
              className="accent-qm-lime"
            />
            <div>
              <span className="text-sm font-medium text-gray-900">Both</span>
              <p className="text-xs text-gray-500">Send via email and SMS</p>
            </div>
          </label>
        </fieldset>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={isPending || (!hasEmail && !hasPhone)}
            className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {isPending ? 'Sending...' : 'Send Quote'}
          </button>
        </div>
      </div>
    </div>
  )
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info'; key: number } | null>(null)
  const [sendingQuote, setSendingQuote] = useState<QuoteRow | null>(null)

  function showToast(message: string, type: 'success' | 'info' = 'success') {
    setToast({ message, type, key: Date.now() })
    setTimeout(() => setToast(null), 5000)
  }

  function handleStatusChange(quoteId: string, newStatus: QuoteStatus) {
    const prev = rows
    setRows((r) => r.map((q) => (q.id === quoteId ? { ...q, status: newStatus } : q)))

    startTransition(async () => {
      const result = await updateQuoteStatus(quoteId, orgId, orgSlug, newStatus)
      if (result.error) {
        setRows(prev) // revert on error
      } else if (result.jobCreated) {
        showToast(`Quote approved — Job #${result.jobCreated} created automatically`)
      }
    })
  }

  const toastColors = toast?.type === 'success'
    ? 'border-green-200 bg-green-50 text-green-800'
    : 'border-blue-200 bg-blue-50 text-blue-800'
  const toastIconColor = toast?.type === 'success' ? 'text-green-600' : 'text-blue-600'

  return (
    <>
      {/* Toast notification */}
      {toast && (
        <div
          key={toast.key}
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg ${toastColors}`}
        >
          <svg className={`h-5 w-5 shrink-0 ${toastIconColor}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
          </svg>
          <span className="text-sm font-medium">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className={`ml-2 rounded p-0.5 ${toastIconColor} hover:opacity-70`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Send modal */}
      {sendingQuote && (
        <SendModal
          quote={sendingQuote}
          orgId={orgId}
          orgSlug={orgSlug}
          onClose={() => setSendingQuote(null)}
          onSent={(msg) => showToast(msg, 'info')}
        />
      )}

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
            <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              Actions
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
              <td className="whitespace-nowrap px-6 py-4">
                {quote.status === 'sent' && (
                  <button
                    onClick={() => setSendingQuote(quote)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-qm-fuchsia px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 transition-all"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                    </svg>
                    Send to Customer
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}
