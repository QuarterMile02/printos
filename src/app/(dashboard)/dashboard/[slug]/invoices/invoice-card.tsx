import Link from 'next/link'
import { formatInvNumber, formatCents, INV_STATUS_STYLES, INV_STATUS_LABELS } from './format'

type InvoiceCardRow = {
  id: string
  invoice_number: number
  status: string
  total: number
  balance_due: number
  due_date: string | null
  created_at: string
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

function formatDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function InvoiceCard({ invoice, orgSlug }: { invoice: InvoiceCardRow; orgSlug: string }) {
  const href = `/dashboard/${orgSlug}/invoices/${invoice.id}`
  const companyName = invoice.customers?.company_name ?? null
  const contactName = invoice.customers
    ? [invoice.customers.first_name, invoice.customers.last_name].filter(Boolean).join(' ')
    : ''
  const dueLabel = formatDate(invoice.due_date)

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all">
      <Link href={href} className="flex flex-col gap-2">
        {/* Invoice number */}
        <div className="text-xs font-semibold text-qm-fuchsia">
          {formatInvNumber(invoice.invoice_number, invoice.created_at)}
        </div>

        {/* Customer */}
        {(companyName || contactName) && (
          <div className="flex flex-col gap-0.5 min-w-0">
            {companyName && (
              <div className="text-sm font-semibold text-qm-black truncate">{companyName}</div>
            )}
            <div className="text-xs text-qm-gray truncate">{contactName}</div>
          </div>
        )}

        {/* Total / Balance Due */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Total</span>
          <span className="font-semibold text-gray-900">${formatCents(invoice.total)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Balance</span>
          <span className={`font-semibold ${invoice.balance_due > 0 ? 'text-red-600' : 'text-green-600'}`}>
            ${formatCents(invoice.balance_due)}
          </span>
        </div>

        {/* Status badge + Due date */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
              INV_STATUS_STYLES[invoice.status] ?? 'bg-gray-100 text-gray-700'
            }`}
          >
            {INV_STATUS_LABELS[invoice.status] ?? invoice.status}
          </span>
          {dueLabel && <span className="text-xs text-gray-400 shrink-0">Due {dueLabel}</span>}
        </div>
      </Link>

      {/* QB export — separate from the card's Link so the click doesn't navigate */}
      <a
        href={`/api/invoices/${invoice.id}/export-iif`}
        className="mt-1 text-xs font-medium text-green-700 hover:text-green-900 hover:underline self-start"
        title="Export to QuickBooks"
      >
        Export to QB
      </a>
    </div>
  )
}
