// Sales Team Pipeline — table grouping open quotes by their owning sales
// rep. The live DB only has quotes.sales_rep_id (migration 021); the
// created_by column from migration 018b was never applied, so referencing
// it raised "column quotes.created_by does not exist". If sales_rep_id is
// also missing on a future deploy we fall back to a single "Unassigned"
// bucket and show the actual error in the widget.

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
  let salesRepIdMissing = false
  try {
    const r = await service
      .from('quotes')
      .select('id, total, created_at, sales_rep_id')
      .eq('organization_id', orgId)
      .in('status', OPEN_STATUSES)
      .limit(5000)
    if (r.error) {
      console.error('[sales-pipeline] quotes query failed:', r.error)
      errorMsg = r.error.message
      // If sales_rep_id itself is missing, retry without it so the table
      // still renders with a single "Unassigned" row.
      if (/column .*sales_rep_id.* does not exist/i.test(r.error.message)) {
        salesRepIdMissing = true
        const fallback = await service
          .from('quotes')
          .select('id, total, created_at')
          .eq('organization_id', orgId)
          .in('status', OPEN_STATUSES)
          .limit(5000)
        if (fallback.error) {
          console.error('[sales-pipeline] fallback failed:', fallback.error)
          errorMsg = fallback.error.message
          throw fallback.error
        }
        rows = ((fallback.data ?? []) as Omit<QuoteRow, 'sales_rep_id'>[])
          .map((q) => ({ ...q, sales_rep_id: null }))
      } else {
        throw r.error
      }
    } else {
      rows = (r.data ?? []) as QuoteRow[]
    }
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

  // Group by sales_rep_id only — created_by from migration 018b was never
  // applied to the live DB.
  type Group = { userId: string | null; ages: number[]; totalCents: number; count: number }
  const now = Date.now()
  const groupMap = new Map<string, Group>()
  for (const q of rows) {
    const ownerId = q.sales_rep_id ?? null
    const key = ownerId ?? '__unassigned__'
    const age = daysBetween(new Date(q.created_at).getTime(), now)
    const g = groupMap.get(key)
    if (g) {
      g.ages.push(age); g.totalCents += Number(q.total ?? 0); g.count++
    } else {
      groupMap.set(key, { userId: ownerId, ages: [age], totalCents: Number(q.total ?? 0), count: 1 })
    }
  }

  // Resolve names for known user ids — try team_members first, then
  // profiles, never crash. team_members may not exist in this schema; if
  // the query fails we silently fall through to profiles.
  const userIds = [...groupMap.keys()].filter(k => k !== '__unassigned__')
  const nameMap = new Map<string, string>()
  if (userIds.length > 0) {
    // 1) team_members lookup (preferred — has first_name + last_name)
    try {
      const r = await service
        .from('team_members')
        .select('user_id, full_name, first_name, last_name')
        .in('user_id', userIds)
      if (r.error) {
        console.warn('[sales-pipeline] team_members lookup failed (will try profiles):', r.error.message)
      } else {
        for (const m of (r.data ?? []) as {
          user_id: string
          full_name: string | null
          first_name: string | null
          last_name: string | null
        }[]) {
          const composed = m.full_name
            ?? [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
          if (composed) nameMap.set(m.user_id, composed)
        }
      }
    } catch (err) {
      console.warn('[sales-pipeline] team_members crash (will try profiles):', err)
    }

    // 2) profiles fallback for any ids still missing a name
    const stillMissing = userIds.filter((id) => !nameMap.has(id))
    if (stillMissing.length > 0) {
      try {
        const r = await service
          .from('profiles')
          .select('id, full_name, email')
          .in('id', stillMissing)
        if (r.error) {
          console.error('[sales-pipeline] profiles lookup failed:', r.error)
        } else {
          for (const p of (r.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
            const composed = p.full_name || p.email
            if (composed) nameMap.set(p.id, composed)
          }
        }
      } catch (err) {
        console.error('[sales-pipeline] profiles crash:', err)
        // remaining ids get the "Rep ID: …" fallback in the stats map below
      }
    }
  }

  const stats: RepStats[] = [...groupMap.entries()].map(([key, g]) => {
    const ages = g.ages.sort((a, b) => a - b)
    const avg = ages.reduce((s, n) => s + n, 0) / ages.length
    const oldest = ages[ages.length - 1]
    const repName = key === '__unassigned__'
      ? 'Unassigned'
      : (nameMap.get(key) ?? `Rep ID: ${key.slice(0, 8)}…`)
    return {
      userId: key === '__unassigned__' ? null : key,
      name: repName,
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
