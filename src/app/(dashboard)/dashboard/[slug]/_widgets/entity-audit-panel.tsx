// Embedded per-entity audit panel (migration 132) — the counterpart to
// orders/[threadId]/page.tsx's centralized cross-entity view. That page
// filters activity_log by order_thread_id (the whole quote→SO→job→invoice
// lifecycle); this panel filters by entity_type + entity_id (idx_activity_
// log_entity_created) — "everything that happened to THIS record," embedded
// directly on its own detail page. Shares grouping/formatting logic with
// the centralized view via @/lib/activity-log-display so an edit renders
// identically on both surfaces.
//
// SCOPE NOTE (same as the centralized view): field-level diff logging
// (field_changed rows) exists today only for invoices. Quote/SO/job pages
// embedding this panel will show plain status-change rows until those
// entities get the same diff-logging treatment — that's expected, not a
// bug in this panel.

import Link from 'next/link'
import type { createClient } from '@/lib/supabase/server'
import { dbOrThrow } from '@/lib/db'
import {
  type ActivityLogRow, groupActivityEntries, activityFieldLabel, resolveActivityFieldValue, fmtRelativeActivity,
} from '@/lib/activity-log-display'

type Props = {
  supabase: Awaited<ReturnType<typeof createClient>>
  orgId: string
  orgSlug: string
  entityType: 'quote' | 'sales_order' | 'job' | 'invoice'
  entityId: string
  // Optional deep-link to the centralized view — pass the resolved
  // order_thread_id (a quotes.id, or a sales_orders.id when there's no
  // quote) if the calling page already has it in scope. Omit to render
  // the panel with no such link (e.g. an entity with no resolvable thread).
  orderThreadId?: string | null
  limit?: number
}

export default async function EntityAuditPanel({
  supabase, orgId, orgSlug, entityType, entityId, orderThreadId, limit = 50,
}: Props) {
  // Fetch the most recent `limit` raw rows (DESC), then reverse to
  // ascending before grouping so a change_group_id's internal field order
  // matches original save order, then reverse the grouped result back to
  // newest-first for display.
  const rowsDesc = (await dbOrThrow(
    supabase
      .from('activity_log')
      .select('id, user_id, entity_type, entity_id, action, from_value, to_value, field_name, change_group_id, created_at')
      .eq('organization_id', orgId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('created_at', { ascending: false })
      .limit(limit)
  ) ?? []) as ActivityLogRow[]

  const entries = groupActivityEntries([...rowsDesc].reverse()).reverse()

  const userIds = Array.from(new Set(rowsDesc.map((r) => r.user_id).filter((v): v is string => !!v)))
  const profileRows = userIds.length
    ? (await dbOrThrow(supabase.from('profiles').select('id, full_name').in('id', userIds)) ?? []) as { id: string; full_name: string | null }[]
    : []
  const nameById = new Map(profileRows.map((p) => [p.id, p.full_name]))

  const customerIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const r of rowsDesc) {
    if (r.field_name === 'customer_id') { if (r.from_value) customerIds.add(r.from_value); if (r.to_value) customerIds.add(r.to_value) }
    if (r.field_name === 'contact_id') { if (r.from_value) contactIds.add(r.from_value); if (r.to_value) contactIds.add(r.to_value) }
  }
  const customerNameById = new Map<string, string>()
  if (customerIds.size) {
    const rows = (await dbOrThrow(
      supabase.from('customers').select('id, first_name, last_name, company_name').in('id', Array.from(customerIds))
    ) ?? []) as { id: string; first_name: string; last_name: string; company_name: string | null }[]
    for (const c of rows) customerNameById.set(c.id, c.company_name || `${c.first_name} ${c.last_name}`.trim())
  }
  const contactNameById = new Map<string, string>()
  if (contactIds.size) {
    const rows = (await dbOrThrow(
      supabase.from('customer_contacts').select('id, full_name').in('id', Array.from(contactIds))
    ) ?? []) as { id: string; full_name: string }[]
    for (const c of rows) contactNameById.set(c.id, c.full_name)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Activity</h2>
        {orderThreadId && (
          <Link href={`/dashboard/${orgSlug}/orders/${orderThreadId}`} className="text-xs font-medium text-qm-fuchsia hover:underline">
            View full order history →
          </Link>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">No activity recorded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {entries.map((e) => {
            const who = e.user_id ? (nameById.get(e.user_id) ?? 'Unknown user') : 'System'
            return (
              <li key={e.id} className="px-6 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {e.kind === 'status' ? (
                      <p className="text-sm text-gray-900">{e.summary}</p>
                    ) : (
                      <ul className="space-y-0.5">
                        {e.fields.map((f, i) => {
                          const from = resolveActivityFieldValue(f.field, f.from, customerNameById, contactNameById)
                          const to = resolveActivityFieldValue(f.field, f.to, customerNameById, contactNameById)
                          return (
                            <li key={i} className="text-sm text-gray-900">
                              <span className="font-medium">{activityFieldLabel(f.field)}:</span>{' '}
                              {from ? <span className="text-gray-500">{from}</span> : <span className="italic text-gray-400">empty</span>}
                              {' → '}
                              {to ? <span>{to}</span> : <span className="italic text-gray-400">empty</span>}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    <p className="mt-1 text-xs text-gray-400">{who}</p>
                  </div>
                  <span className="shrink-0 text-xs text-gray-500 tabular-nums">{fmtRelativeActivity(e.created_at)}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {rowsDesc.length === limit && (
        <div className="border-t border-gray-100 px-6 py-3 text-center text-xs text-gray-400">
          Showing the most recent {limit} events.
        </div>
      )}
    </div>
  )
}
