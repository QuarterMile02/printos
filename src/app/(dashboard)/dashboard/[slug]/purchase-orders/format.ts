export function formatPoNumber(num: number, createdAtIso: string): string {
  const year = new Date(createdAtIso).getFullYear()
  return `PO-${year}-${String(num).padStart(4, '0')}`
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
