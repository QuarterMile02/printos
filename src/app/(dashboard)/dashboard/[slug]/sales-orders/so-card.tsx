import Link from 'next/link'
import type { SalesOrderStatus } from '@/types/database'
import { formatSoNumber, formatCents, SO_STATUS_STYLES, SO_STATUS_LABELS } from './format'

type SoCardRow = {
  id: string
  so_number: number
  title: string | null
  status: SalesOrderStatus
  total: number | null
  created_at: string
  customers: { first_name: string; last_name: string; company_name: string | null } | null
  shipments: { id: string }[] | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function SalesOrderCard({
  so,
  orgSlug,
  canSeePricing,
}: {
  so: SoCardRow
  orgSlug: string
  canSeePricing: boolean
}) {
  const href = `/dashboard/${orgSlug}/sales-orders/${so.id}`
  const companyName = so.customers?.company_name ?? null
  const contactName = so.customers
    ? [so.customers.first_name, so.customers.last_name].filter(Boolean).join(' ')
    : ''
  const shipCount = so.shipments?.length ?? 0

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      {/* SO number */}
      <div className="text-xs font-semibold text-qm-fuchsia">
        {formatSoNumber(so.so_number, so.created_at)}
      </div>

      {/* Title */}
      <div className="font-semibold text-sm text-qm-black truncate" title={so.title || undefined}>
        {so.title || <span className="font-normal text-gray-400">Untitled</span>}
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
      {canSeePricing && so.total != null && (
        <div className="text-sm font-semibold text-gray-900">${formatCents(so.total)}</div>
      )}

      {/* Shipments count (only when > 0) */}
      {shipCount > 0 && (
        <div className="inline-flex items-center gap-1 text-xs text-blue-700">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
          </svg>
          {shipCount} shipment{shipCount !== 1 ? 's' : ''}
        </div>
      )}

      {/* Status badge + Created date */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            SO_STATUS_STYLES[so.status] ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {SO_STATUS_LABELS[so.status] ?? so.status}
        </span>
        <span className="text-xs text-gray-400 shrink-0">{formatDate(so.created_at)}</span>
      </div>
    </Link>
  )
}
