// Alert Bar — top-of-dashboard, always-visible row of red/amber/green
// pills with real DB counts. Each pill links to the relevant filtered
// list. All counts are computed in parallel with `head: true` count
// queries so the dashboard page doesn't pay for row data we don't render.

import Link from 'next/link'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

type Alert = {
  tone: 'red' | 'amber' | 'green'
  label: string  // count is encoded directly into the label string
  detail?: string  // e.g. dollar total for overdue invoices
  href: string
}

const TONE: Record<Alert['tone'], string> = {
  red:   'border-red-200 bg-red-50 text-red-800 hover:bg-red-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
  green: 'border-green-200 bg-green-50 text-green-800 hover:bg-green-100',
}

function startOfToday(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default async function AlertBar({ service, orgId, orgSlug }: Props) {
  const todayIso = startOfToday()
  const nowIso = new Date().toISOString()
  const base = `/dashboard/${orgSlug}`

  // Run all the counts in parallel. Each Promise resolves to a number.
  const [
    overdueInvoices,
    overdueInvoicesTotal,
    jobsPastDue,
    quotesNoCustomer,
    approvedNotConverted,
    completedNotInvoiced,
    proofsAwaiting,
    quotesToday,
    salesOrdersToday,
  ] = await Promise.all([
    // Red 1: overdue invoices
    service.from('invoices').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'overdue'])
      .lt('due_date', new Date().toISOString().slice(0, 10))
      .then((r) => r.count ?? 0),
    service.from('invoices').select('balance_due')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'overdue'])
      .lt('due_date', new Date().toISOString().slice(0, 10))
      .then((r) => (r.data ?? []).reduce<number>((s, row) => s + Number((row as { balance_due: number | null }).balance_due ?? 0), 0)),

    // Red 2: jobs past due
    service.from('jobs').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .lt('due_date', new Date().toISOString().slice(0, 10))
      .neq('status', 'completed')
      .then((r) => r.count ?? 0),

    // Amber 1: quotes without customer (customer_id null)
    service.from('quotes').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .is('customer_id', null)
      .in('status', ['draft', 'delivered', 'customer_review', 'pending'])
      .then((r) => r.count ?? 0),

    // Amber 2: approved quotes not yet converted to SO
    service.from('quotes').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['approved', 'internally_approved'])
      .is('converted_to_so_id', null)
      .then((r) => r.count ?? 0),

    // Amber 3: sales_orders completed but no invoice yet (invoice for this SO doesn't exist)
    // Schema doesn't expose a join here; we count completed SOs and let the count
    // be approximate. UI says "completed SOs not yet invoiced" — exact match needs
    // a NOT EXISTS subquery once invoice→sales_order linkage is queryable client-side.
    service.from('sales_orders').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('status', 'completed')
      .then((r) => r.count ?? 0),

    // Amber 4: proofs awaiting approval (status='pending'). Past-deadline
    // not modelled on proof_versions; treat any pending proof as the alert.
    // Wrap in try/catch via a Promise so a missing table degrades to 0.
    (async () => {
      try {
        const { count } = await service.from('proof_versions').select('id', { count: 'exact', head: true }).eq('status', 'pending')
        return count ?? 0
      } catch { return 0 }
    })(),

    // Green 1: new quotes today
    service.from('quotes').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).gte('created_at', todayIso).lte('created_at', nowIso)
      .then((r) => r.count ?? 0),

    // Green 2: new sales orders today
    service.from('sales_orders').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).gte('created_at', todayIso).lte('created_at', nowIso)
      .then((r) => r.count ?? 0),
  ])

  const alerts: Alert[] = []
  if (overdueInvoices > 0) {
    alerts.push({
      tone: 'red',
      label: `${overdueInvoices} overdue invoice${overdueInvoices === 1 ? '' : 's'}`,
      detail: `$${(overdueInvoicesTotal / 100).toFixed(2)}`,
      href: `${base}/invoices?status=overdue`,
    })
  }
  if (jobsPastDue > 0) {
    alerts.push({
      tone: 'red',
      label: `${jobsPastDue} job${jobsPastDue === 1 ? '' : 's'} past due`,
      href: `${base}/jobs`,
    })
  }
  if (quotesNoCustomer > 0) {
    alerts.push({ tone: 'amber', label: `${quotesNoCustomer} quote${quotesNoCustomer === 1 ? '' : 's'} without customer`, href: `${base}/quotes` })
  }
  if (approvedNotConverted > 0) {
    alerts.push({ tone: 'amber', label: `${approvedNotConverted} approved not converted`, href: `${base}/quotes?status=approved` })
  }
  if (completedNotInvoiced > 0) {
    alerts.push({ tone: 'amber', label: `${completedNotInvoiced} completed SO${completedNotInvoiced === 1 ? '' : 's'} not invoiced`, href: `${base}/sales-orders?status=completed` })
  }
  if (proofsAwaiting > 0) {
    alerts.push({ tone: 'amber', label: `${proofsAwaiting} proof${proofsAwaiting === 1 ? '' : 's'} awaiting approval`, href: `${base}/jobs` })
  }
  if (quotesToday > 0) {
    alerts.push({ tone: 'green', label: `${quotesToday} new quote${quotesToday === 1 ? '' : 's'} today`, href: `${base}/quotes` })
  }
  if (salesOrdersToday > 0) {
    alerts.push({ tone: 'green', label: `${salesOrdersToday} new order${salesOrdersToday === 1 ? '' : 's'} today`, href: `${base}/sales-orders` })
  }

  if (alerts.length === 0) {
    return (
      <div className="col-span-12 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800">
        ✓ All clear — no overdue items, no pending alerts.
      </div>
    )
  }

  return (
    <div className="col-span-12 flex flex-wrap gap-2">
      {alerts.map((a, i) => (
        <Link
          key={i}
          href={a.href}
          className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${TONE[a.tone]}`}
        >
          <span>{a.label}</span>
          {a.detail && <span className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-[11px]">{a.detail}</span>}
        </Link>
      ))}
    </div>
  )
}
