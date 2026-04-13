export function formatInvNumber(num: number, createdAtIso: string): string {
  const year = new Date(createdAtIso).getFullYear()
  return `INV-${year}-${String(num).padStart(4, '0')}`
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const INV_STATUS_STYLES: Record<string, string> = {
  draft:   'bg-gray-100 text-gray-700',
  sent:    'bg-blue-50 text-blue-700',
  paid:    'bg-green-50 text-green-700',
  partial: 'bg-amber-50 text-amber-700',
  overdue: 'bg-red-50 text-red-700',
  void:    'bg-red-100 text-red-800',
}

export const INV_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', sent: 'Sent', paid: 'Paid',
  partial: 'Partial', overdue: 'Overdue', void: 'Void',
}

export const INV_FILTER_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
]
