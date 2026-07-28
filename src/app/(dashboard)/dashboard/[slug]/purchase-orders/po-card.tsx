import Link from 'next/link'
import { formatPoNumber, formatPoTotal, PO_STATUS_STYLES, PO_STATUS_LABELS } from './format'

type PoCardRow = {
  id: string
  po_number: number
  title: string | null
  status: string
  total: number
  expected_delivery_date: string | null
  received_date: string | null
  created_at: string
  vendors: { name: string } | null
}

// timeZone: 'UTC' keeps this in sync with formatPoNumber's getUTCFullYear —
// pins the calendar day to the stored UTC instant so server/client renders
// match, avoiding a hydration mismatch near a UTC midnight boundary.
function formatDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

export function PurchaseOrderCard({ po, orgSlug }: { po: PoCardRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/purchase-orders/${po.id}`
  const vendorName = po.vendors?.name ?? null
  const expectedLabel = formatDate(po.expected_delivery_date)
  const receivedLabel = formatDate(po.received_date)

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      {/* PO number */}
      <div className="text-xs font-semibold text-qm-fuchsia">
        {formatPoNumber(po.po_number, po.created_at)}
      </div>

      {/* Title */}
      <div className="font-semibold text-sm text-qm-black truncate" title={po.title || undefined}>
        {po.title || <span className="font-normal text-gray-400">Untitled</span>}
      </div>

      {/* Vendor */}
      {vendorName && (
        <div className="text-xs font-medium text-gray-700 truncate">{vendorName}</div>
      )}

      {/* Total */}
      <div className="text-sm font-semibold text-gray-900">${formatPoTotal(po.total)}</div>

      {/* Receiving status */}
      {receivedLabel && (
        <div className="text-xs text-green-700">Received {receivedLabel}</div>
      )}

      {/* Status badge + Expected delivery / Created date */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            PO_STATUS_STYLES[po.status] ?? 'bg-gray-100 text-gray-700'
          }`}
        >
          {PO_STATUS_LABELS[po.status] ?? po.status}
        </span>
        {expectedLabel && <span className="text-xs text-gray-400 shrink-0">Exp. {expectedLabel}</span>}
      </div>
    </Link>
  )
}
