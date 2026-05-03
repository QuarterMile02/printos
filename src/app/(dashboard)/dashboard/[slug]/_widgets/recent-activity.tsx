// Recent Activity — last 5 entries from activity_log.
// - Owner sees all org activity.
// - Everyone else sees only their own actions (user_id = self).

import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/permissions'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
  userId: string
  role: Role
}

type ActivityRow = {
  id: string
  user_id: string | null
  entity_type: string
  entity_id: string
  action: string
  from_value: string | null
  to_value: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function fmtRelative(iso: string): string {
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

function summarize(r: ActivityRow): string {
  const parts: string[] = [r.action.replace(/_/g, ' ')]
  if (r.from_value && r.to_value) parts.push(`${r.from_value} → ${r.to_value}`)
  else if (r.to_value) parts.push(`→ ${r.to_value}`)
  return parts.join(' ')
}

function entityHref(orgSlug: string, type: string, id: string): string | null {
  const base = `/dashboard/${orgSlug}`
  switch (type) {
    case 'quote':        return `${base}/quotes/${id}`
    case 'sales_order':  return `${base}/sales-orders/${id}`
    case 'job':          return `${base}/jobs/${id}`
    case 'invoice':      return `${base}/invoices/${id}`
    case 'customer':     return `${base}/customers/${id}`
    default:             return null
  }
}

export default async function RecentActivity({ service, orgId, orgSlug, userId, role }: Props) {
  let q = service
    .from('activity_log')
    .select('id, user_id, entity_type, entity_id, action, from_value, to_value, metadata, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(5)
  if (role !== 'owner') q = q.eq('user_id', userId)

  const { data } = await q as { data: ActivityRow[] | null; error: unknown }
  const rows = data ?? []

  return (
    <WidgetCard title="Recent Activity">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No activity recorded yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => {
            const href = entityHref(orgSlug, r.entity_type, r.entity_id)
            const inner = (
              <div className="flex items-center gap-3 py-2 text-sm">
                <span className="inline-block rounded bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                  {r.entity_type.replace(/_/g, ' ')}
                </span>
                <span className="text-[#1A1A1A] truncate flex-1">{summarize(r)}</span>
                <span className="text-xs text-gray-500 shrink-0">{fmtRelative(r.created_at)}</span>
              </div>
            )
            return (
              <li key={r.id}>
                {href ? <Link href={href} className="block hover:bg-gray-50 rounded px-2 -mx-2">{inner}</Link> : inner}
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
