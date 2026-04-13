import type { SalesOrderStatus } from '@/types/database'

export function formatSoNumber(num: number, createdAtIso: string): string {
  const year = new Date(createdAtIso).getFullYear()
  return `SO-${year}-${String(num).padStart(4, '0')}`
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export const SO_STATUS_STYLES: Record<SalesOrderStatus, string> = {
  new:                'bg-gray-100 text-gray-700',
  in_process:         'bg-blue-50 text-blue-700',
  completed:          'bg-green-50 text-green-700',
  hold:               'bg-orange-100 text-orange-800',
  no_charge:          'bg-gray-100 text-gray-600',
  no_charge_approved: 'bg-teal-50 text-teal-700',
  void:               'bg-red-100 text-red-800',
}

export const SO_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  new: 'New',
  in_process: 'In Process',
  completed: 'Completed',
  hold: 'Hold',
  no_charge: 'No Charge',
  no_charge_approved: 'No Charge Approved',
  void: 'Void',
}

export const SO_FILTER_TABS: { value: 'all' | SalesOrderStatus; label: string }[] = [
  { value: 'all',          label: 'All' },
  { value: 'new',          label: 'New' },
  { value: 'in_process',   label: 'In Process' },
  { value: 'completed',    label: 'Completed' },
  { value: 'hold',         label: 'Hold' },
  { value: 'void',         label: 'Void' },
]
