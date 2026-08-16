// Shared display logic for activity_log rows — grouping, summarizing, and
// field-name/value formatting. Used by both the centralized order-lifecycle
// view (orders/[threadId]/page.tsx, filtered by order_thread_id) and the
// embedded per-entity audit panels (_widgets/entity-audit-panel.tsx,
// filtered by entity_type + entity_id) so the two surfaces render an edit
// identically instead of drifting apart.

export type ActivityLogRow = {
  id: string
  user_id: string | null
  entity_type: string
  entity_id: string
  action: string
  from_value: string | null
  to_value: string | null
  field_name: string | null
  change_group_id: string | null
  created_at: string
}

export type ActivityDisplayEntry =
  | { kind: 'status'; id: string; created_at: string; user_id: string | null; entity_type: string; entity_id: string; summary: string }
  | { kind: 'fields'; id: string; created_at: string; user_id: string | null; entity_type: string; entity_id: string; fields: { field: string; from: string | null; to: string | null }[] }

// Groups field_changed rows sharing one change_group_id (one save action)
// into a single entry — matches insertInvoiceFieldDiffs's write-side intent
// ("Ruben changed 3 fields at 2:14pm" renders as one entry, not three).
// Expects rows in ascending created_at order — callers displaying
// newest-first should reverse the returned array, not the input, so each
// group's internal `fields` order stays in original save order.
export function groupActivityEntries(rows: ActivityLogRow[]): ActivityDisplayEntry[] {
  const entries: ActivityDisplayEntry[] = []
  const groupIdx = new Map<string, number>()
  for (const r of rows) {
    if (r.action === 'field_changed' && r.change_group_id) {
      let idx = groupIdx.get(r.change_group_id)
      if (idx === undefined) {
        entries.push({ kind: 'fields', id: r.change_group_id, created_at: r.created_at, user_id: r.user_id, entity_type: r.entity_type, entity_id: r.entity_id, fields: [] })
        idx = entries.length - 1
        groupIdx.set(r.change_group_id, idx)
      }
      const entry = entries[idx]
      if (entry.kind === 'fields') entry.fields.push({ field: r.field_name ?? 'field', from: r.from_value, to: r.to_value })
    } else {
      entries.push({ kind: 'status', id: r.id, created_at: r.created_at, user_id: r.user_id, entity_type: r.entity_type, entity_id: r.entity_id, summary: summarizeActivityAction(r) })
    }
  }
  return entries
}

export function summarizeActivityAction(r: ActivityLogRow): string {
  const label = r.action.replace(/_/g, ' ')
  if (r.from_value && r.to_value) return `${label}: ${r.from_value} → ${r.to_value}`
  if (r.to_value) return `${label} → ${r.to_value}`
  return label
}

const FIELD_LABEL_OVERRIDES: Record<string, string> = { zip: 'ZIP' }
export function activityFieldLabel(field: string): string {
  return field.split('_').map((w) => FIELD_LABEL_OVERRIDES[w] ?? (w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
}

// customer_id/contact_id diffs store raw UUIDs (that's what's actually in
// activity_log.from_value/to_value) — resolve to a display name so they
// read like every other field instead of standing out as opaque ids.
// Falls back to the raw id if the row was deleted since (still honest,
// just not pretty — better than silently showing nothing).
export function resolveActivityFieldValue(
  field: string, value: string | null,
  customerNameById: Map<string, string>, contactNameById: Map<string, string>,
): string | null {
  if (!value) return null
  if (field === 'customer_id') return customerNameById.get(value) ?? value
  if (field === 'contact_id') return contactNameById.get(value) ?? value
  return value
}

export function fmtRelativeActivity(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
