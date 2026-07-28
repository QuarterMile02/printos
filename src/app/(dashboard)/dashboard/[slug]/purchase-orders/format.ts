export function formatPoNumber(num: number, createdAtIso: string): string {
  // getUTCFullYear (not getFullYear) — a timestamp near a year boundary can
  // resolve to a different calendar year on the server (UTC) vs. the
  // client's local timezone, causing a hydration text mismatch. This exact
  // class of bug broke Sales Order row links in production earlier tonight.
  const year = new Date(createdAtIso).getUTCFullYear()
  return `PO-${year}-${String(num).padStart(4, '0')}`
}

// purchase_orders.total/subtotal/tax_total are NUMERIC(12,2) — real dollars
// and cents (e.g. 207.84), NOT integer cents like quotes/invoices/sales_orders
// (which store 20784 for the same amount). Do not reuse those tables'
// formatCents (÷100) or dollar-to-cents (×100) search conversions here — both
// would silently produce a value 100x wrong.
export function formatPoTotal(n: number | string): string {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const PO_STATUS_STYLES: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-700',
  sent:      'bg-blue-50 text-blue-700',
  partial:   'bg-amber-50 text-amber-700',
  received:  'bg-green-50 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

export const PO_STATUS_LABELS: Record<string, string> = {
  draft:     'Draft',
  sent:      'Sent',
  partial:   'Partial',
  received:  'Received',
  cancelled: 'Cancelled',
}

export const PO_FILTER_TABS = [
  { value: 'all',       label: 'All' },
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'partial',   label: 'Partial' },
  { value: 'received',  label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
]

export const PO_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'draft',     label: 'Draft' },
  { value: 'sent',      label: 'Sent' },
  { value: 'partial',   label: 'Partial' },
  { value: 'received',  label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
]
