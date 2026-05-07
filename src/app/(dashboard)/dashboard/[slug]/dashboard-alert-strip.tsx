// Persistent alert strip that sits at the very top of the org dashboard
// (above all widgets, below the top nav). Every pill ALWAYS renders so a
// single failing query can never hide the others — failed pills silently
// fall back to grey + count 0. Errors still go to console for Vercel logs.

import Link from 'next/link'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

type Tone = 'red' | 'amber' | 'green' | 'grey'

type Pill = {
  tone: Tone
  icon: string
  label: string
  href: string
}

const TONE_BORDER: Record<Tone, string> = {
  red:   'border-l-[3px] border-l-[#ee2b7b]',
  amber: 'border-l-[3px] border-l-amber-400',
  green: 'border-l-[3px] border-l-[#93ca3b]',
  grey:  'border-l-[3px] border-l-[#555]',
}

const TONE_BG: Record<Tone, string> = {
  red:   'bg-[#ee2b7b]/15 hover:bg-[#ee2b7b]/25 text-pink-100',
  amber: 'bg-amber-400/15 hover:bg-amber-400/25 text-amber-100',
  green: 'bg-[#93ca3b]/15 hover:bg-[#93ca3b]/25 text-[#d6efb1]',
  grey:  'bg-[#2a2a2a] hover:bg-[#333] text-[#888]',
}

const fmtMoney = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default async function DashboardAlertStrip({ service, orgId, orgSlug }: Props) {
  const todayDate = new Date().toISOString().slice(0, 10)
  const base = `/dashboard/${orgSlug}`

  // ── PILL 1 — Quotes Approved Today (informational, green tone) ───────
  // 'internally_approved' is not a member of the quote_status enum on
  // the live DB, so the IN list uses only 'approved'. updated_at filter
  // bounded by today's start/end (UTC).
  const approvedTodayPromise: Promise<number> = (async () => {
    try {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart.getTime() + 86_400_000)
      const r = await service
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'approved')
        .gte('updated_at', dayStart.toISOString())
        .lt('updated_at', dayEnd.toISOString())
      if (r.error) {
        console.error('[alert-strip] approved-today query error:', r.error)
        return 0
      }
      return r.count ?? 0
    } catch (e) {
      console.error('[alert-strip] approved-today crash:', e)
      return 0
    }
  })()

  // ── PILL 2 — Overdue invoices, aged into 4 buckets ───────────────────
  type OverdueBuckets = { b0_30: number; b31_60: number; b61_90: number; b90: number; sumCents: number }
  const overduePromise: Promise<OverdueBuckets> = (async () => {
    const empty: OverdueBuckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, sumCents: 0 }
    try {
      const r = await service
        .from('invoices')
        .select('due_date, balance_due')
        .eq('organization_id', orgId)
        .not('status', 'in', '(paid,cancelled,draft)')
        .lt('due_date', todayDate)
        .limit(2000)
      if (r.error) {
        console.error('[alert-strip] overdue query error:', r.error)
        return empty
      }
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const out: OverdueBuckets = { ...empty }
      for (const row of (r.data ?? []) as { due_date: string | null; balance_due: number | null }[]) {
        if (!row.due_date) continue
        const bal = Number(row.balance_due ?? 0)
        if (bal <= 0) continue
        const due = new Date(row.due_date + 'T00:00:00').getTime()
        const days = Math.floor((today.getTime() - due) / 86_400_000)
        if (days < 1) continue
        if (days <= 30) out.b0_30++
        else if (days <= 60) out.b31_60++
        else if (days <= 90) out.b61_90++
        else out.b90++
        out.sumCents += bal
      }
      return out
    } catch (e) {
      console.error('[alert-strip] overdue crash:', e)
      return empty
    }
  })()

  // ── PILL 3 — Completed jobs not yet invoiced ─────────────────────────
  // Tries three queries in order, picks the first that works against the
  // live schema:
  //   (a) jobs.invoice_id IS NULL
  //   (b) jobs.invoiced = false
  //   (c) just status = 'completed' as a count proxy
  // The pill label adapts to (c) — "Completed Jobs" instead of
  // "...Not Invoiced" so it isn't misleading when we don't actually know.
  type CompletedResult = { count: number; mode: 'invoice_id' | 'invoiced' | 'count_only' }
  const completedNotInvoicedPromise: Promise<CompletedResult> = (async () => {
    // (a) invoice_id IS NULL
    try {
      const r = await service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'completed')
        .is('invoice_id', null)
      if (!r.error) return { count: r.count ?? 0, mode: 'invoice_id' }
      console.warn('[alert-strip] completed-not-invoiced (invoice_id) failed:', r.error.message)
    } catch (e) {
      console.warn('[alert-strip] completed-not-invoiced (invoice_id) crash:', e)
    }
    // (b) invoiced = false
    try {
      const r = await service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'completed')
        .eq('invoiced', false)
      if (!r.error) return { count: r.count ?? 0, mode: 'invoiced' }
      console.warn('[alert-strip] completed-not-invoiced (invoiced) failed:', r.error.message)
    } catch (e) {
      console.warn('[alert-strip] completed-not-invoiced (invoiced) crash:', e)
    }
    // (c) count proxy — all completed jobs
    try {
      const r = await service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'completed')
      if (!r.error) return { count: r.count ?? 0, mode: 'count_only' }
      console.error('[alert-strip] completed-not-invoiced (count_only) failed:', r.error)
    } catch (e) {
      console.error('[alert-strip] completed-not-invoiced (count_only) crash:', e)
    }
    return { count: 0, mode: 'count_only' }
  })()

  // ── PILL 4 — Proofs past deadline ────────────────────────────────────
  // proof_due_date and/or proof_status may not exist on the live jobs
  // table. If the query fails (column missing or anything else), the
  // pill silently shows 0 — never surfaces the error to the user.
  const proofsOverduePromise: Promise<number> = (async () => {
    try {
      const r = await service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .lt('proof_due_date', todayDate)
        .neq('proof_status', 'approved')
      if (r.error) {
        console.warn('[alert-strip] proofs-overdue query failed (likely missing columns):', r.error.message)
        return 0
      }
      return r.count ?? 0
    } catch (e) {
      console.warn('[alert-strip] proofs-overdue crash:', e)
      return 0
    }
  })()

  const [approvedToday, overdue, completed, proofsOverdue] = await Promise.all([
    approvedTodayPromise,
    overduePromise,
    completedNotInvoicedPromise,
    proofsOverduePromise,
  ])

  const overdueTotal = overdue.b0_30 + overdue.b31_60 + overdue.b61_90 + overdue.b90
  const overdueLabel = overdueTotal === 0
    ? `Overdue Invoices: ${fmtMoney(0)}`
    : `Overdue: ${overdue.b0_30} (0-30d) · ${overdue.b31_60} (31-60d) · ${overdue.b61_90} (61-90d) · ${overdue.b90} (90+d) — ${fmtMoney(overdue.sumCents)}`

  const completedLabel = completed.mode === 'count_only'
    ? `${completed.count} Completed Job${completed.count === 1 ? '' : 's'}`
    : `${completed.count} Completed Job${completed.count === 1 ? '' : 's'} Not Invoiced`

  const pills: Pill[] = [
    {
      tone: approvedToday > 0 ? 'green' : 'grey',
      icon: '⚡',
      label: `${approvedToday} Quote${approvedToday === 1 ? '' : 's'} Approved Today`,
      href: `${base}/quotes?status=approved`,
    },
    {
      tone: overdueTotal > 0 ? 'red' : 'grey',
      icon: '🔴',
      label: overdueLabel,
      href: `${base}/invoices?status=overdue`,
    },
    {
      tone: completed.count > 0 ? 'amber' : 'grey',
      icon: '⚠️',
      label: completedLabel,
      href: `${base}/jobs?status=completed&invoiced=false`,
    },
    {
      tone: proofsOverdue > 0 ? 'amber' : 'grey',
      icon: '🎨',
      label: `${proofsOverdue} Proof${proofsOverdue === 1 ? '' : 's'} Past Deadline`,
      href: `${base}/jobs?proof_overdue=true`,
    },
  ]

  return (
    <div className="bg-[#1A1A1A] -mx-8 mb-6 px-8 py-2">
      <div className="max-w-7xl flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        {pills.map((p, i) => (
          <Link
            key={i}
            href={p.href}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1 transition ${TONE_BORDER[p.tone]} ${TONE_BG[p.tone]}`}
          >
            <span aria-hidden>{p.icon}</span>
            <span className="font-medium">{p.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
