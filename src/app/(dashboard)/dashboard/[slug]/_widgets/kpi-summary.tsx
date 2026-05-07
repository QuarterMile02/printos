// KPI Department Summary — owner-only widget that surfaces 4 cards
// (Production / Design / Sales / Accounting) with 3-4 metrics each.
// Every metric is independently wrapped in try/catch so a missing column
// shows "—" for that metric without breaking neighbors or the dashboard.

import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
}

type Metric = { label: string; value: string }

function startOfMonthIso(): string {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}
function todayIsoDate(): string { return new Date().toISOString().slice(0, 10) }
function fmtMoney(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtInt(n: number): string { return n.toLocaleString('en-US') }
function fmtPct(n: number): string { return `${n.toFixed(1)}%` }

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch { return null }
}

export default async function KpiSummary({ service, orgId }: Props) {
  const monthStart = startOfMonthIso()
  const today = todayIsoDate()

  // ── PRODUCTION ────────────────────────────────────────────────────────
  const sqftThisMonth = await safe(async () => {
    // Speculative — quote_line_items has width/height; jobs may not.
    // Multiply by job count via source_quote_id linkage. If columns absent,
    // catch falls through to null.
    const r = await service
      .from('quote_line_items')
      .select('width, height, quantity, jobs!inner(completed_at, organization_id)')
      .gte('jobs.completed_at', monthStart)
      .eq('jobs.organization_id', orgId)
    if (r.error) throw r.error
    let total = 0
    for (const li of (r.data ?? []) as { width: number | null; height: number | null; quantity: number | null }[]) {
      const w = Number(li.width ?? 0) / 12
      const h = Number(li.height ?? 0) / 12
      const q = Number(li.quantity ?? 1)
      if (w > 0 && h > 0) total += w * h * q
    }
    return total
  })

  const jobsCompletedThisMonth = await safe(async () => {
    const r = await service
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('status', 'completed')
      .gte('completed_at', monthStart)
    if (r.error) throw r.error
    return r.count ?? 0
  })

  const jobsPastDue = await safe(async () => {
    const r = await service
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .neq('status', 'completed')
      .lt('due_date', today)
    if (r.error) throw r.error
    return r.count ?? 0
  })

  const productionMetrics: Metric[] = [
    { label: 'Sq Ft Produced (MTD)', value: sqftThisMonth != null ? fmtInt(Math.round(sqftThisMonth)) : '—' },
    { label: 'Jobs Completed (MTD)', value: jobsCompletedThisMonth != null ? fmtInt(jobsCompletedThisMonth) : '—' },
    { label: 'Past Due Jobs',        value: jobsPastDue != null ? fmtInt(jobsPastDue) : '—' },
  ]

  // ── DESIGN ────────────────────────────────────────────────────────────
  // Avg turnaround uses proof_sent_at which may not exist.
  const designAvgHours = await safe(async () => {
    const r = await service
      .from('jobs')
      .select('created_at, proof_sent_at')
      .eq('organization_id', orgId)
      .gte('proof_sent_at', monthStart)
      .not('proof_sent_at', 'is', null)
      .limit(2000)
    if (r.error) throw r.error
    const rows = (r.data ?? []) as { created_at: string | null; proof_sent_at: string | null }[]
    if (rows.length === 0) return 0
    let totalMs = 0
    let n = 0
    for (const row of rows) {
      if (!row.created_at || !row.proof_sent_at) continue
      const d = new Date(row.proof_sent_at).getTime() - new Date(row.created_at).getTime()
      if (d > 0) { totalMs += d; n++ }
    }
    return n === 0 ? 0 : totalMs / n / 3_600_000
  })

  const proofsSent = await safe(async () => {
    const r = await service
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .gte('proof_sent_at', monthStart)
    if (r.error) throw r.error
    return r.count ?? 0
  })

  const revisionRate = await safe(async () => {
    const [revCount, totalCount] = await Promise.all([
      service.from('jobs').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('status', 'change_requested')
        .gte('created_at', monthStart),
      service.from('jobs').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).gte('created_at', monthStart),
    ])
    if (revCount.error || totalCount.error) throw revCount.error ?? totalCount.error
    const t = totalCount.count ?? 0
    if (t === 0) return 0
    return ((revCount.count ?? 0) / t) * 100
  })

  const designMetrics: Metric[] = [
    { label: 'Avg Design Turnaround', value: designAvgHours != null ? `${designAvgHours.toFixed(1)} hrs` : '—' },
    { label: 'Proofs Sent (MTD)',     value: proofsSent != null ? fmtInt(proofsSent) : '—' },
    { label: 'Revision Rate',         value: revisionRate != null ? fmtPct(revisionRate) : '—' },
  ]

  // ── SALES ─────────────────────────────────────────────────────────────
  const closeRate = await safe(async () => {
    const [allQuotes, convertedQuotes] = await Promise.all([
      service.from('quotes').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).gte('created_at', monthStart),
      service.from('quotes').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).gte('created_at', monthStart)
        .not('converted_to_so_id', 'is', null),
    ])
    if (allQuotes.error || convertedQuotes.error) throw allQuotes.error ?? convertedQuotes.error
    const total = allQuotes.count ?? 0
    if (total === 0) return 0
    return ((convertedQuotes.count ?? 0) / total) * 100
  })

  const quotesSent = await safe(async () => {
    const r = await service.from('quotes').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).gte('created_at', monthStart)
    if (r.error) throw r.error
    return r.count ?? 0
  })

  const avgDealSize = await safe(async () => {
    const r = await service.from('sales_orders').select('total')
      .eq('organization_id', orgId).gte('created_at', monthStart).limit(2000)
    if (r.error) throw r.error
    const totals = ((r.data ?? []) as { total: number | null }[])
      .map(s => Number(s.total ?? 0)).filter(t => t > 0)
    if (totals.length === 0) return 0
    return totals.reduce((s, n) => s + n, 0) / totals.length
  })

  const salesMetrics: Metric[] = [
    { label: 'Close Rate (MTD)',  value: closeRate != null ? fmtPct(closeRate) : '—' },
    { label: 'Quotes Sent (MTD)', value: quotesSent != null ? fmtInt(quotesSent) : '—' },
    { label: 'Avg Deal Size',     value: avgDealSize != null ? fmtMoney(avgDealSize) : '—' },
  ]

  // ── ACCOUNTING ────────────────────────────────────────────────────────
  const totalInvoiced = await safe(async () => {
    const r = await service.from('invoices').select('total')
      .eq('organization_id', orgId).gte('created_at', monthStart).limit(5000)
    if (r.error) throw r.error
    return ((r.data ?? []) as { total: number | null }[])
      .reduce((s, row) => s + Number(row.total ?? 0), 0)
  })

  const totalCollected = await safe(async () => {
    // No `payments` table in this schema; use invoices.amount_paid as a
    // proxy for "applied this month". Imperfect (amount_paid is a running
    // total per invoice) but useful directional signal.
    const r = await service.from('invoices').select('amount_paid')
      .eq('organization_id', orgId).gte('updated_at', monthStart).limit(5000)
    if (r.error) throw r.error
    return ((r.data ?? []) as { amount_paid: number | null }[])
      .reduce((s, row) => s + Number(row.amount_paid ?? 0), 0)
  })

  const outstandingAr = await safe(async () => {
    const r = await service.from('invoices').select('balance_due')
      .eq('organization_id', orgId).neq('status', 'paid').limit(5000)
    if (r.error) throw r.error
    return ((r.data ?? []) as { balance_due: number | null }[])
      .reduce((s, row) => s + Number(row.balance_due ?? 0), 0)
  })

  const dso = await safe(async () => {
    if (outstandingAr == null) return null
    const since = new Date(); since.setDate(since.getDate() - 30); since.setHours(0, 0, 0, 0)
    const r = await service.from('invoices').select('total')
      .eq('organization_id', orgId).gte('created_at', since.toISOString()).limit(5000)
    if (r.error) throw r.error
    const last30 = ((r.data ?? []) as { total: number | null }[])
      .reduce((s, row) => s + Number(row.total ?? 0), 0)
    if (last30 <= 0) return null
    return outstandingAr / (last30 / 30)
  })

  const accountingMetrics: Metric[] = [
    { label: 'Invoiced (MTD)',  value: totalInvoiced != null ? fmtMoney(totalInvoiced) : '—' },
    { label: 'Collected (MTD)', value: totalCollected != null ? fmtMoney(totalCollected) : '—' },
    { label: 'Outstanding AR',  value: outstandingAr != null ? fmtMoney(outstandingAr) : '—' },
    { label: 'DSO',             value: dso != null ? `${dso.toFixed(1)} days` : '—' },
  ]

  return (
    <WidgetCard title="KPI Department Summary" span={12}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <KpiCard title="Production" accent="#93ca3b" metrics={productionMetrics} />
        <KpiCard title="Design"     accent="#3b82f6" metrics={designMetrics} />
        <KpiCard title="Sales"      accent="#ee2b7b" metrics={salesMetrics} />
        <KpiCard title="Accounting" accent="#f59e0b" metrics={accountingMetrics} />
      </div>
    </WidgetCard>
  )
}

function KpiCard({ title, accent, metrics }: { title: string; accent: string; metrics: Metric[] }) {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white p-4 border-l-[3px]"
      style={{ borderLeftColor: accent }}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">{title}</div>
      <dl className="space-y-2">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center justify-between gap-2">
            <dt className="text-sm text-gray-600">{m.label}</dt>
            <dd className="text-sm font-bold tabular-nums text-[#1A1A1A]">{m.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
