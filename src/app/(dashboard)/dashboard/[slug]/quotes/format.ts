import type { QuoteStatus, SalesOrderStatus } from '@/types/database'

// Display helpers for quote / sales order numbers.
//
// Numbers are stored as small integers per organization; the
// "Q-2026-0001" / "SO-2026-0001" format is rendered at the edge from
// the row's created_at year + zero-padded number.

export function formatQuoteNumber(num: number, createdAtIso: string): string {
  const year = new Date(createdAtIso).getFullYear()
  return `Q-${year}-${String(num).padStart(4, '0')}`
}

export function formatSoNumber(num: number, createdAtIso: string): string {
  const year = new Date(createdAtIso).getFullYear()
  return `SO-${year}-${String(num).padStart(4, '0')}`
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Tailwind classes per quote status. Used by both the list table and
// the detail page so colors stay consistent.
export const QUOTE_STATUS_STYLES: Record<QuoteStatus, string> = {
  draft:                'bg-gray-100 text-gray-700',
  delivered:            'bg-blue-50 text-blue-700',
  customer_review:      'bg-amber-50 text-amber-700',
  approved:             'bg-green-50 text-green-700',
  approve_with_changes: 'bg-teal-50 text-teal-700',
  revise:               'bg-orange-50 text-orange-700',
  ordered:              'bg-purple-50 text-purple-700',
  hold:                 'bg-orange-100 text-orange-800',
  expired:              'bg-red-50 text-red-700',
  lost:                 'bg-red-100 text-red-800',
  pending:              'bg-gray-100 text-gray-600',
  no_charge:            'bg-gray-100 text-gray-600',
  // Legacy
  sent:                 'bg-blue-50 text-blue-700',
  declined:             'bg-red-100 text-red-800',
}

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  delivered: 'Delivered',
  customer_review: 'Customer Review',
  approved: 'Approved',
  approve_with_changes: 'Approve with Changes',
  revise: 'Revise',
  ordered: 'Ordered',
  hold: 'Hold',
  expired: 'Expired',
  lost: 'Lost',
  pending: 'Pending',
  no_charge: 'No Charge',
  sent: 'Sent (legacy)',
  declined: 'Declined (legacy)',
}

// Statuses surfaced in the list page filter tabs (legacy values hidden).
export const QUOTE_FILTER_TABS: { value: 'all' | QuoteStatus; label: string }[] = [
  { value: 'all',             label: 'All' },
  { value: 'draft',           label: 'Draft' },
  { value: 'delivered',       label: 'Delivered' },
  { value: 'customer_review', label: 'Customer Review' },
  { value: 'approved',        label: 'Approved' },
  { value: 'ordered',         label: 'Ordered' },
  { value: 'hold',            label: 'Hold' },
  { value: 'expired',         label: 'Expired' },
  { value: 'lost',            label: 'Lost' },
]

// All non-legacy statuses, ordered for the manual <select> on the
// detail page. Auto-transition statuses (delivered, customer_review,
// ordered) are still in this list so users can override if they need to.
export const QUOTE_STATUS_OPTIONS: { value: QuoteStatus; label: string }[] = [
  { value: 'draft',                label: 'Draft' },
  { value: 'delivered',            label: 'Delivered' },
  { value: 'customer_review',      label: 'Customer Review' },
  { value: 'approved',             label: 'Approved' },
  { value: 'approve_with_changes', label: 'Approve with Changes' },
  { value: 'revise',               label: 'Revise' },
  { value: 'ordered',              label: 'Ordered' },
  { value: 'hold',                 label: 'Hold' },
  { value: 'expired',              label: 'Expired' },
  { value: 'lost',                 label: 'Lost' },
  { value: 'pending',              label: 'Pending' },
  { value: 'no_charge',            label: 'No Charge' },
]

// Phase 8 line-item rule: only show Width/Height inputs when the
// product's pricing formula actually uses dimensions.
const DIMENSIONAL_FORMULAS = new Set(['Area', 'Perimeter', 'Width', 'Height'])
export function productUsesDimensions(formula: string | null | undefined): boolean {
  if (!formula) return false
  return Array.from(DIMENSIONAL_FORMULAS).some((f) => formula.includes(f))
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

// Hardcoded for QMI in Laredo TX. Move to org settings later if other
// shops onboard.
export const TAX_RATE = 0.0825
