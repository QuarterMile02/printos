export const SHIP_STATUS_STYLES: Record<string, string> = {
  pending:   'bg-gray-100 text-gray-700',
  shipped:   'bg-blue-50 text-blue-700',
  delivered: 'bg-green-50 text-green-700',
  returned:  'bg-red-50 text-red-700',
}

export const SHIP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  shipped: 'Shipped',
  delivered: 'Delivered',
  returned: 'Returned',
}

export const SHIP_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'returned', label: 'Returned' },
]

export function formatShipDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
