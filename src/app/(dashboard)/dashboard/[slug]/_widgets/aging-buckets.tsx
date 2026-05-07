// Aging Buckets — overdue invoices grouped into 4 buckets by days past
// due_date. Each bucket row shows count + total balance_due and links to
// the invoices list pre-filtered to that bucket via ?overdue_bucket=…
//
// Source query: invoices WHERE status NOT IN ('paid','cancelled','draft')
// AND due_date < today AND organization_id = org. Bucketing happens in JS
// so we round-trip the DB once instead of four times.

import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

type InvoiceRow = {
  due_date: string | null
  balance_due: number | null
}

type Bucket = {
  key: '0-30' | '31-60' | '61-90' | '90+'
  label: string
  borderColor: string
  count: number
  totalCents: number
}

function ageInDays(dueDate: string | null): number {
  if (!dueDate) return -1
  const due = new Date(dueDate + 'T00:00:00').getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - due) / 86_400_000)
}

function fmtMoney(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function AgingBuckets({ service, orgId, orgSlug }: Props) {
  const todayDate = new Date().toISOString().slice(0, 10)
  const { data } = await service
    .from('invoices')
    .select('due_date, balance_due')
    .eq('organization_id', orgId)
    .not('status', 'in', '(paid,cancelled,draft)')
    .not('due_date', 'is', null)
    .lt('due_date', todayDate)
    .limit(2000) as { data: InvoiceRow[] | null; error: unknown }

  const buckets: Bucket[] = [
    { key: '0-30',  label: '0-30 days',   borderColor: '#93ca3b', count: 0, totalCents: 0 },
    { key: '31-60', label: '31-60 days',  borderColor: '#fbbf24', count: 0, totalCents: 0 }, // amber-400
    { key: '61-90', label: '61-90 days',  borderColor: '#fb923c', count: 0, totalCents: 0 }, // orange-400
    { key: '90+',   label: '90+ days',    borderColor: '#ee2b7b', count: 0, totalCents: 0 },
  ]
  for (const r of data ?? []) {
    const age = ageInDays(r.due_date)
    if (age < 1) continue
    const bal = Number(r.balance_due ?? 0)
    if (bal <= 0) continue
    if (age <= 30) { buckets[0].count++; buckets[0].totalCents += bal }
    else if (age <= 60) { buckets[1].count++; buckets[1].totalCents += bal }
    else if (age <= 90) { buckets[2].count++; buckets[2].totalCents += bal }
    else { buckets[3].count++; buckets[3].totalCents += bal }
  }

  const grandTotalCents = buckets.reduce((s, b) => s + b.totalCents, 0)
  const grandCount = buckets.reduce((s, b) => s + b.count, 0)

  return (
    <WidgetCard title="Overdue Invoices Aging" span={6}>
      {grandCount === 0 ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-green-800">✅ No overdue invoices</p>
        </div>
      ) : (
        <>
          <div className="mb-3 px-1">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500">Total Outstanding</div>
            <div className="text-2xl font-extrabold tabular-nums text-[#1A1A1A]">{fmtMoney(grandTotalCents)}</div>
          </div>
          <ul className="space-y-1.5">
            {buckets.map((b) => (
              <li key={b.key}>
                <Link
                  href={`/dashboard/${orgSlug}/invoices?overdue_bucket=${b.key}`}
                  className="flex items-center justify-between gap-3 rounded-md border-l-[3px] bg-gray-50 hover:bg-gray-100 px-3 py-2 transition-colors"
                  style={{ borderLeftColor: b.borderColor }}
                >
                  <span className="text-sm font-semibold text-[#1A1A1A] w-24 shrink-0">{b.label}</span>
                  <span className="text-xs text-gray-500 w-20 text-right tabular-nums">
                    {b.count} inv{b.count === 1 ? '.' : 's.'}
                  </span>
                  <span className="text-sm font-bold tabular-nums text-[#1A1A1A] flex-1 text-right">
                    {fmtMoney(b.totalCents)}
                  </span>
                  <span aria-hidden className="text-gray-400">→</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  )
}
