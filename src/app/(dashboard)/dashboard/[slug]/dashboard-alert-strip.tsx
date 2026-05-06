// Persistent alert strip that sits at the very top of the org dashboard
// (above all widgets, below the top nav). Counts are fetched in parallel
// with HEAD queries so we don't pull row data we don't render. Pills that
// reference DB columns that may not exist (jobs.invoice_id,
// jobs.proof_due_date) are wrapped in try/catch and skip gracefully.

import Link from 'next/link'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

type Tone = 'red' | 'amber' | 'grey'

type Pill = {
  tone: Tone
  icon: string
  label: string
  href: string
}

const TONE_BORDER: Record<Tone, string> = {
  red:   'border-l-[3px] border-l-[#ee2b7b]',
  amber: 'border-l-[3px] border-l-amber-400',
  grey:  'border-l-[3px] border-l-gray-700',
}

const TONE_BG: Record<Tone, string> = {
  red:   'bg-[#ee2b7b]/15 hover:bg-[#ee2b7b]/25 text-pink-100',
  amber: 'bg-amber-400/15 hover:bg-amber-400/25 text-amber-100',
  grey:  'bg-white/5 hover:bg-white/10 text-gray-400',
}

const fmtMoney = (cents: number) =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default async function DashboardAlertStrip({ service, orgId, orgSlug }: Props) {
  const todayDate = new Date().toISOString().slice(0, 10)
  const base = `/dashboard/${orgSlug}`

  // PILL 1 — approved quotes pending conversion
  // Schema uses `converted_to_so_id` (per migrations 018b/019/020), not
  // `sales_order_id` as in the spec.
  const approvedPromise = (async (): Promise<number | null> => {
    try {
      const r = await service
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .in('status', ['approved', 'internally_approved'])
        .is('converted_to_so_id', null)
      if (r.error) return null
      return r.count ?? 0
    } catch { return null }
  })()

  // PILL 2 — overdue invoices (count + sum of balance_due in cents)
  const overdueCountPromise = (async (): Promise<number | null> => {
    try {
      const r = await service
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .neq('status', 'paid')
        .lt('due_date', todayDate)
      if (r.error) return null
      return r.count ?? 0
    } catch { return null }
  })()
  const overdueSumPromise = (async (): Promise<number> => {
    try {
      const r = await service
        .from('invoices')
        .select('balance_due')
        .eq('organization_id', orgId)
        .neq('status', 'paid')
        .lt('due_date', todayDate)
      return (r.data ?? []).reduce<number>(
        (s, row) => s + Number((row as { balance_due: number | null }).balance_due ?? 0),
        0,
      )
    } catch { return 0 }
  })()

  // PILL 3 — completed jobs not yet invoiced. jobs.invoice_id may not
  // exist — wrap so a missing column degrades to null (pill skipped).
  const completedNotInvoicedPromise = (async (): Promise<number | null> => {
    try {
      const r = await service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'completed')
        .is('invoice_id', null)
      if (r.error) return null
      return r.count ?? 0
    } catch { return null }
  })()

  // PILL 4 — proofs past deadline. proof_due_date / proof_status may not
  // exist on the jobs table. Skip on error.
  const proofsOverduePromise = (async (): Promise<number | null> => {
    try {
      const r = await service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .lt('proof_due_date', todayDate)
        .neq('proof_status', 'approved')
      if (r.error) return null
      return r.count ?? 0
    } catch { return null }
  })()

  const [approved, overdueCount, overdueSum, completedNotInvoiced, proofsOverdue] = await Promise.all([
    approvedPromise,
    overdueCountPromise,
    overdueSumPromise,
    completedNotInvoicedPromise,
    proofsOverduePromise,
  ])

  const pills: Pill[] = []

  if (approved !== null) {
    pills.push({
      tone: approved > 0 ? 'red' : 'grey',
      icon: '⚡',
      label: `${approved} Approved Quote${approved === 1 ? '' : 's'} Need Conversion`,
      href: `${base}/quotes?status=approved`,
    })
  }

  if (overdueCount !== null) {
    const moneyTag = overdueCount > 0 ? ` — ${fmtMoney(overdueSum)}` : ''
    pills.push({
      tone: overdueCount > 0 ? 'red' : 'grey',
      icon: '🔴',
      label: `${overdueCount} Overdue Invoice${overdueCount === 1 ? '' : 's'}${moneyTag}`,
      href: `${base}/invoices?status=overdue`,
    })
  }

  if (completedNotInvoiced !== null) {
    pills.push({
      tone: completedNotInvoiced > 0 ? 'amber' : 'grey',
      icon: '⚠️',
      label: `${completedNotInvoiced} Completed Job${completedNotInvoiced === 1 ? '' : 's'} Not Invoiced`,
      href: `${base}/jobs?status=completed&invoiced=false`,
    })
  }

  if (proofsOverdue !== null) {
    pills.push({
      tone: proofsOverdue > 0 ? 'amber' : 'grey',
      icon: '🎨',
      label: `${proofsOverdue} Proof${proofsOverdue === 1 ? '' : 's'} Past Deadline`,
      href: `${base}/jobs?proof_overdue=true`,
    })
  }

  // Hide entire bar if every pill is 0 (nothing actionable).
  const anyActive = pills.some(p => p.tone !== 'grey')
  if (!anyActive) return null

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
