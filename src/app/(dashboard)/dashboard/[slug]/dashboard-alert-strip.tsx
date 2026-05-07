// Persistent alert strip that sits at the very top of the org dashboard
// (above all widgets, below the top nav). Every pill ALWAYS renders so a
// single failing query can never hide the others — failed pills fall back
// to grey + count 0 + a small "(query failed)" subtext for diagnostics.

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
  errorMsg?: string  // surfaces under the label as a tiny diagnostic
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

function errorMessage(label: string, e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return `${label}: ${(e as { message: string }).message}`
  }
  return `${label}: ${String(e)}`
}

export default async function DashboardAlertStrip({ service, orgId, orgSlug }: Props) {
  const todayDate = new Date().toISOString().slice(0, 10)
  const base = `/dashboard/${orgSlug}`

  // ── PILL 1 — Quotes Approved Today (informational, green tone) ───────
  type ApprovedResult = { count: number; error: string | null }
  const approvedTodayPromise: Promise<ApprovedResult> = (async () => {
    try {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart.getTime() + 86_400_000)
      const r = await service
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .in('status', ['approved', 'internally_approved'])
        .gte('updated_at', dayStart.toISOString())
        .lt('updated_at', dayEnd.toISOString())
      if (r.error) {
        console.error('[alert-strip] approved-today query error:', r.error)
        return { count: 0, error: errorMessage('approved-today', r.error) }
      }
      return { count: r.count ?? 0, error: null }
    } catch (e) {
      console.error('[alert-strip] approved-today crash:', e)
      return { count: 0, error: errorMessage('approved-today', e) }
    }
  })()

  // ── PILL 2 — Overdue invoices, aged into 4 buckets ───────────────────
  type OverdueBuckets = { b0_30: number; b31_60: number; b61_90: number; b90: number; sumCents: number }
  type OverdueResult = { buckets: OverdueBuckets; error: string | null }
  const overduePromise: Promise<OverdueResult> = (async () => {
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
        return { buckets: empty, error: errorMessage('overdue', r.error) }
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
      return { buckets: out, error: null }
    } catch (e) {
      console.error('[alert-strip] overdue crash:', e)
      return { buckets: empty, error: errorMessage('overdue', e) }
    }
  })()

  // ── PILL 3 — Completed jobs not yet invoiced ─────────────────────────
  type SimpleResult = { count: number; error: string | null }
  const completedNotInvoicedPromise: Promise<SimpleResult> = (async () => {
    try {
      const r = await service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'completed')
        .is('invoice_id', null)
      if (r.error) {
        console.error('[alert-strip] completed-not-invoiced query error:', r.error)
        return { count: 0, error: errorMessage('completed-not-invoiced', r.error) }
      }
      return { count: r.count ?? 0, error: null }
    } catch (e) {
      console.error('[alert-strip] completed-not-invoiced crash:', e)
      return { count: 0, error: errorMessage('completed-not-invoiced', e) }
    }
  })()

  // ── PILL 4 — Proofs past deadline ────────────────────────────────────
  const proofsOverduePromise: Promise<SimpleResult> = (async () => {
    try {
      const r = await service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .lt('proof_due_date', todayDate)
        .neq('proof_status', 'approved')
      if (r.error) {
        console.error('[alert-strip] proofs-overdue query error:', r.error)
        return { count: 0, error: errorMessage('proofs-overdue', r.error) }
      }
      return { count: r.count ?? 0, error: null }
    } catch (e) {
      console.error('[alert-strip] proofs-overdue crash:', e)
      return { count: 0, error: errorMessage('proofs-overdue', e) }
    }
  })()

  const [approvedToday, overdue, completedNotInvoiced, proofsOverdue] = await Promise.all([
    approvedTodayPromise,
    overduePromise,
    completedNotInvoicedPromise,
    proofsOverduePromise,
  ])

  // Build all 4 pills unconditionally. A failed query renders grey + 0 +
  // tiny "(query failed)" subtext for diagnostics.
  const pills: Pill[] = [
    {
      tone: approvedToday.error ? 'grey' : (approvedToday.count > 0 ? 'green' : 'grey'),
      icon: '⚡',
      label: `${approvedToday.count} Quote${approvedToday.count === 1 ? '' : 's'} Approved Today`,
      href: `${base}/quotes?status=approved`,
      errorMsg: approvedToday.error ?? undefined,
    },
    (() => {
      const b = overdue.buckets
      const total = b.b0_30 + b.b31_60 + b.b61_90 + b.b90
      const label = total === 0
        ? `Overdue Invoices: ${fmtMoney(0)}`
        : `Overdue: ${b.b0_30} (0-30d) · ${b.b31_60} (31-60d) · ${b.b61_90} (61-90d) · ${b.b90} (90+d) — ${fmtMoney(b.sumCents)}`
      return {
        tone: overdue.error ? 'grey' : (total > 0 ? 'red' : 'grey'),
        icon: '🔴',
        label,
        href: `${base}/invoices?status=overdue`,
        errorMsg: overdue.error ?? undefined,
      } as Pill
    })(),
    {
      tone: completedNotInvoiced.error ? 'grey' : (completedNotInvoiced.count > 0 ? 'amber' : 'grey'),
      icon: '⚠️',
      label: `${completedNotInvoiced.count} Completed Job${completedNotInvoiced.count === 1 ? '' : 's'} Not Invoiced`,
      href: `${base}/jobs?status=completed&invoiced=false`,
      errorMsg: completedNotInvoiced.error ?? undefined,
    },
    {
      tone: proofsOverdue.error ? 'grey' : (proofsOverdue.count > 0 ? 'amber' : 'grey'),
      icon: '🎨',
      label: `${proofsOverdue.count} Proof${proofsOverdue.count === 1 ? '' : 's'} Past Deadline`,
      href: `${base}/jobs?proof_overdue=true`,
      errorMsg: proofsOverdue.error ?? undefined,
    },
  ]

  return (
    <div className="bg-[#1A1A1A] -mx-8 mb-6 px-8 py-2">
      <div className="max-w-7xl flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        {pills.map((p, i) => (
          <Link
            key={i}
            href={p.href}
            className={`inline-flex flex-col items-start rounded px-3 py-1 transition ${TONE_BORDER[p.tone]} ${TONE_BG[p.tone]}`}
            title={p.errorMsg}
          >
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden>{p.icon}</span>
              <span className="font-medium">{p.label}</span>
            </span>
            {p.errorMsg && (
              <span className="text-[10px] text-gray-600 leading-tight mt-0.5">(query failed)</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
