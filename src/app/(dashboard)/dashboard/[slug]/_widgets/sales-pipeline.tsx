// Sales Team Pipeline — table grouping open quotes by their owning sales
// rep. Schema has both quotes.sales_rep_id (from migration 021, the
// proper "assigned to" column) and quotes.created_by; we prefer
// sales_rep_id and fall back to created_by. Names are resolved via
// profiles (id == auth.users.id).

import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

// Whitelist of "still open" quote_status enum values (verified in migrations
// 002 and 018a). Original spec wanted NOT IN cancelled/invoiced/paid/
// completed, but those aren't members of the quote_status enum — passing
// them to PostgREST raises "invalid input value for enum" and crashes the
// query. Using IN with valid open statuses gives equivalent semantics.
const OPEN_STATUSES = [
  'draft', 'sent', 'delivered', 'customer_review', 'approve_with_changes',
  'revise', 'hold', 'pending', 'approved',
]

type QuoteRow = {
  id: string
  total: number | null
  created_at: string
  sales_rep_id: string | null
  created_by: string | null
}

type RepStats = {
  userId: string | null  // null = unassigned
  name: string
  count: number
  totalCents: number
  avgAgeDays: number
  oldestAgeDays: number
}

function daysBetween(from: number, to: number): number {
  return Math.floor((to - from) / 86_400_000)
}

function fmtMoney(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default async function SalesPipeline({ service, orgId, orgSlug }: Props) {
  let rows: QuoteRow[] = []
  let loadOk = true
  let errorMsg: string | null = null
  try {
    const r = await service
      .from('quotes')
      .select('id, total, created_at, sales_rep_id, created_by')
      .eq('organization_id', orgId)
      .in('status', OPEN_STATUSES)
      .limit(5000)
    if (r.error) {
      console.error('[sales-pipeline] quotes query failed:', r.error)
      errorMsg = r.error.message
      throw r.error
    }
    rows = (r.data ?? []) as QuoteRow[]
  } catch (err) {
    console.error('[sales-pipeline] crash:', err)
    if (!errorMsg && err instanceof Error) errorMsg = err.message
    loadOk = false
  }

  if (!loadOk) {
    return (
      <WidgetCard title="Sales Team Pipeline" span={12}>
        <div className="py-6 text-center text-sm text-gray-400">
          <p>Unable to load pipeline</p>
          {errorMsg && <p className="mt-1 text-xs text-red-500 font-mono">{errorMsg}</p>}
        </div>
      </WidgetCard>
    )
  }

  // Group by sales_rep_id (preferred), falling back to created_by
  type Group = { userId: string | null; ages: number[]; totalCents: number; count: number }
  const now = Date.now()
  const groupMap = new Map<string, Group>()
  for (const q of rows) {
    const ownerId = q.sales_rep_id ?? q.created_by ?? null
    const key = ownerId ?? '__unassigned__'
    const age = daysBetween(new Date(q.created_at).getTime(), now)
    const g = groupMap.get(key)
    if (g) {
      g.ages.push(age); g.totalCents += Number(q.total ?? 0); g.count++
    } else {
      groupMap.set(key, { userId: ownerId, ages: [age], totalCents: Number(q.total ?? 0), count: 1 })
    }
  }

  // Resolve names for known user ids
  const userIds = [...groupMap.keys()].filter(k => k !== '__unassigned__')
  const nameMap = new Map<string, string>()
  if (userIds.length > 0) {
    try {
      const r = await service
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds)
      if (r.error) {
        console.error('[sales-pipeline] profiles lookup failed:', r.error)
      } else {
        for (const p of (r.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
          nameMap.set(p.id, p.full_name || p.email || '(unnamed)')
        }
      }
    } catch (err) {
      console.error('[sales-pipeline] profiles crash:', err)
      // names unavailable — fall back to short uuid prefix below
    }
  }

  const stats: RepStats[] = [...groupMap.entries()].map(([key, g]) => {
    const ages = g.ages.sort((a, b) => a - b)
    const avg = ages.reduce((s, n) => s + n, 0) / ages.length
    const oldest = ages[ages.length - 1]
    return {
      userId: key === '__unassigned__' ? null : key,
      name: key === '__unassigned__' ? 'Unassigned' : (nameMap.get(key) ?? key.slice(0, 8)),
      count: g.count,
      totalCents: g.totalCents,
      avgAgeDays: Math.round(avg),
      oldestAgeDays: oldest,
    }
  })

  // Sort: real reps first (by total DESC), then unassigned at the bottom.
  stats.sort((a, b) => {
    if (a.userId === null && b.userId !== null) return 1
    if (b.userId === null && a.userId !== null) return -1
    return b.totalCents - a.totalCents
  })

  const totalQuotes = stats.reduce((s, r) => s + r.count, 0)
  const totalValue  = stats.reduce((s, r) => s + r.totalCents, 0)

  const rowTone = (avgAge: number): string => {
    if (avgAge > 60) return 'bg-[#ee2b7b]/10'
    if (avgAge > 30) return 'bg-amber-50'
    return 'hover:bg-gray-50'
  }

  return (
    <WidgetCard title="Sales Team Pipeline" span={12}>
      {stats.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No open quotes in pipeline</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-100">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Sales Rep</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Open Quotes</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Total Value</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Avg Age</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Oldest Quote</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats.map((r) => {
                const tone = rowTone(r.avgAgeDays)
                const href = r.userId
                  ? `/dashboard/${orgSlug}/quotes?assigned_to=${r.userId}`
                  : `/dashboard/${orgSlug}/quotes`
                return (
                  <tr key={r.userId ?? '__unassigned__'} className={tone}>
                    <td className="px-3 py-2 font-semibold text-[#1A1A1A]">
                      <Link href={href} className="hover:text-[#93ca3b]">{r.name}</Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtMoney(r.totalCents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.avgAgeDays} days</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.oldestAgeDays} days ago</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td className="px-3 py-2 text-xs uppercase tracking-wide font-bold text-gray-500">Total</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-[#1A1A1A]">{totalQuotes}</td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-[#1A1A1A]">{fmtMoney(totalValue)}</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </WidgetCard>
  )
}
