// My Sales Leads — open leads assigned to the current user, sorted by
// next_contact_date. Wraps the query in try/catch so the widget degrades
// to a "No leads yet" stub when the sales_leads table is absent.
//
// Schema note (bug fixed 2026-08-16): sales_leads has no company/
// contact_name/status columns at all — this widget used to select them
// directly and silently render a fake "No leads yet" empty state on
// every real page load, since the resulting Postgres error was swallowed
// by the try/catch below. Company/contact name come from the joined
// customers row (via customer_id, nullable — a lead need not have a
// customer yet); "status" doesn't exist — the real field is stage_id, a
// FK to pipeline_stages, joined here the same way the main Leads board
// (leads/LeadsPageClient.tsx) and the sales-leads API route already do.
// Won/lost filtering is via won_at/lost_at IS NULL, not a status enum —
// matches LeadsPageClient's own `!l.won_at && !l.lost_at` definition of
// "active."

import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
  userId: string
}

type LeadRow = {
  id: string
  title: string
  next_contact_date: string | null
  estimated_value: number | null
  customer: { company_name: string | null; first_name: string | null; last_name: string | null } | null
  stage: { id: string; name: string; color: string } | null
}

function customerLabel(c: LeadRow['customer']): string | null {
  if (!c) return null
  return c.company_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || null
}

function dueState(d: string | null): { tone: 'red' | 'amber' | 'normal'; label: string } {
  if (!d) return { tone: 'normal', label: '—' }
  const target = new Date(d + 'T00:00:00').getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.floor((target - today.getTime()) / 86_400_000)
  if (days < 0)  return { tone: 'red',   label: 'OVERDUE' }
  if (days === 0) return { tone: 'amber', label: 'TODAY' }
  return { tone: 'normal', label: new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
}

export default async function MySalesLeads({ service, orgId, orgSlug, userId }: Props) {
  let rows: LeadRow[] | null = null
  let total = 0

  try {
    const [listRes, countRes] = await Promise.all([
      service
        .from('sales_leads')
        .select(`
          id, title, next_contact_date, estimated_value,
          customer:customers(company_name, first_name, last_name),
          stage:pipeline_stages(id, name, color)
        `)
        .eq('organization_id', orgId)
        .eq('assigned_to', userId)
        .is('won_at', null)
        .is('lost_at', null)
        .order('next_contact_date', { ascending: true, nullsFirst: false })
        .limit(5),
      service
        .from('sales_leads')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('assigned_to', userId)
        .is('won_at', null)
        .is('lost_at', null),
    ])
    if (listRes.error) throw listRes.error
    rows = (listRes.data ?? []) as unknown as LeadRow[]
    total = countRes.count ?? rows.length
  } catch {
    rows = null
  }

  const subtitle = rows !== null && total > 0
    ? `${total} open lead${total === 1 ? '' : 's'}`
    : undefined

  return (
    <WidgetCard
      title="My Sales Leads"
      subtitle={subtitle}
      span={6}
      action={
        // The Leads board lives at /leads, not /sales-leads — this link
        // (and the per-lead links below) pointed at a route that doesn't
        // exist anywhere in the app. Fixed alongside the query bug since
        // a widget showing correct data but 404ing on click isn't really
        // fixed either.
        <Link href={`/dashboard/${orgSlug}/leads`} className="text-xs font-medium text-[#93ca3b] hover:underline">
          View all →
        </Link>
      }
    >
      {rows === null ? (
        <p className="py-6 text-center text-sm text-gray-400">No leads yet</p>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No open leads assigned to you</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((l) => {
            const due = dueState(l.next_contact_date)
            const dueCls = due.tone === 'red'
              ? 'text-red-600 font-semibold'
              : due.tone === 'amber'
                ? 'text-amber-600 font-semibold'
                : 'text-gray-500'
            const company = customerLabel(l.customer)
            return (
              <li key={l.id}>
                <Link
                  href={`/dashboard/${orgSlug}/leads`}
                  className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-[#1A1A1A] truncate">{l.title}</div>
                    {company && <div className="text-xs text-gray-500 truncate">{company}</div>}
                  </div>
                  <span className={`text-xs whitespace-nowrap ${dueCls}`}>{due.label}</span>
                  {l.stage ? (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-gray-700"
                      style={{ backgroundColor: `${l.stage.color}22` }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: l.stage.color }} />
                      {l.stage.name}
                    </span>
                  ) : (
                    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                      No stage
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
