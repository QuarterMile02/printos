import Link from 'next/link'
import type { QuoteStatus } from '@/types/database'
import {
  formatQuoteNumber,
  formatCents,
  QUOTE_STATUS_STYLES,
  QUOTE_STATUS_LABELS,
} from './format'

type QuoteCardRow = {
  id: string
  quote_number: number
  title: string
  status: QuoteStatus
  created_at: string
  total: number | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function QuoteCard({
  quote,
  orgSlug,
  canSeePricing,
}: {
  quote: QuoteCardRow
  orgSlug: string
  canSeePricing: boolean
}) {
  const href = `/dashboard/${orgSlug}/quotes/${quote.id}`
  const companyName = quote.customers?.company_name ?? null
  const contactName = quote.customers
    ? [quote.customers.first_name, quote.customers.last_name].filter(Boolean).join(' ')
    : ''

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      {/* Quote number */}
      <div className="text-xs font-semibold text-qm-fuchsia">
        {formatQuoteNumber(quote.quote_number, quote.created_at)}
      </div>

      {/* Title */}
      <div className="font-semibold text-sm text-qm-black truncate" title={quote.title || undefined}>
        {quote.title || <span className="font-normal text-gray-400">Untitled</span>}
      </div>

      {/* Customer */}
      {(companyName || contactName) && (
        <div className="flex flex-col gap-0.5 min-w-0">
          {companyName && (
            <div className="text-xs font-medium text-gray-700 truncate">{companyName}</div>
          )}
          {contactName && (
            <div className="text-xs text-qm-gray truncate">{contactName}</div>
          )}
        </div>
      )}

      {/* Total (gated on canSeePricing) */}
      {canSeePricing && quote.total != null && (
        <div className="text-sm font-semibold text-gray-900">${formatCents(quote.total)}</div>
      )}

      {/* Status badge + Created date */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            QUOTE_STATUS_STYLES[quote.status] ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {QUOTE_STATUS_LABELS[quote.status] ?? quote.status}
        </span>
        <span className="text-xs text-gray-400 shrink-0">{formatDate(quote.created_at)}</span>
      </div>
    </Link>
  )
}
