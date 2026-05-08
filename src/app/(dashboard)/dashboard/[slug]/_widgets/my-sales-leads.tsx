// My Sales Leads — open leads assigned to the current user, sorted by
// next_contact_date. Wraps the query in try/catch so the widget degrades
// to a "No leads yet" stub when the sales_leads table is absent.

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
  company: string | null
  contact_name: string | null
  status: string | null
  next_contact_date: string | null
}

const STATUS_STYLES: Record<string, string> = {
  new:       'bg-blue-50 text-blue-700',
  contacted: 'bg-purple-50 text-purple-700',
  qualified: 'bg-green-50 text-green-700',
  proposal:  'bg-amber-50 text-amber-700',
}

function statusLabel(s: string | null): string {
  if (!s) return '—'
  return s.charAt(0).toUpperCase() + s.slice(1)
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
        .select('id, company, contact_name, status, next_contact_date')
        .eq('organization_id', orgId)
        .eq('assigned_to', userId)
        .neq('status', 'won')
        .neq('status', 'lost')
        .order('next_contact_date', { ascending: true, nullsFirst: false })
        .limit(5),
      service
        .from('sales_leads')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('assigned_to', userId)
        .neq('status', 'won')
        .neq('status', 'lost'),
    ])
    if (listRes.error) throw listRes.error
    rows = (listRes.data ?? []) as LeadRow[]
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
        <Link href={`/dashboard/${orgSlug}/sales-leads`} className="text-xs font-medium text-[#93ca3b] hover:underline">
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
            return (
              <li key={l.id}>
                <Link
                  href={`/dashboard/${orgSlug}/sales-leads/${l.id}`}
                  className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-[#1A1A1A] truncate">
                      {l.company ?? l.contact_name ?? 'Untitled lead'}
                    </div>
                    {l.company && l.contact_name && (
                      <div className="text-xs text-gray-500 truncate">{l.contact_name}</div>
                    )}
                  </div>
                  <span className={`text-xs whitespace-nowrap ${dueCls}`}>{due.label}</span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[l.status ?? ''] ?? 'bg-gray-100 text-gray-600'}`}>
                    {statusLabel(l.status)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
