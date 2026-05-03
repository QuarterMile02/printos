// Aging Buckets — overdue invoices grouped into 4 buckets by days past
// due_date. Each bucket shows count + total balance_due, sorted largest
// total first. Click each to jump to the invoices report (the report's
// status=overdue filter narrows it; bucket-specific filtering is a
// follow-up once the invoices report supports a min/max age param).

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
  id: string
  due_date: string | null
  total: number | null
  amount_paid: number | null
  balance_due: number | null
  status: string
}

type Bucket = { label: string; min: number; max: number; count: number; total: number }

function ageInDays(dueDate: string | null): number {
  if (!dueDate) return -1
  const due = new Date(dueDate + 'T00:00:00').getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - due) / (1000 * 60 * 60 * 24))
}

function formatCents(c: number): string { return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

export default async function AgingBuckets({ service, orgId, orgSlug }: Props) {
  // Pull every still-owing invoice in one shot. RLS guards by org.
  // Filtering on date in JS lets us share the same fetch for all buckets;
  // n is small enough (overdue invoices, not full history) that this is fine.
  const todayDate = new Date().toISOString().slice(0, 10)
  const { data } = await service
    .from('invoices')
    .select('id, due_date, total, amount_paid, balance_due, status')
    .eq('organization_id', orgId)
    .in('status', ['sent', 'partial', 'overdue'])
    .not('due_date', 'is', null)
    .lt('due_date', todayDate)
    .limit(2000) as { data: InvoiceRow[] | null; error: unknown }

  const buckets: Bucket[] = [
    { label: '0–30 days',  min: 1,  max: 30,        count: 0, total: 0 },
    { label: '31–60 days', min: 31, max: 60,        count: 0, total: 0 },
    { label: '61–90 days', min: 61, max: 90,        count: 0, total: 0 },
    { label: '90+ days',   min: 91, max: Infinity,  count: 0, total: 0 },
  ]
  for (const r of data ?? []) {
    const age = ageInDays(r.due_date)
    if (age < 1) continue
    const bal = Number(r.balance_due ?? 0)
    if (bal <= 0) continue
    for (const b of buckets) {
      if (age >= b.min && age <= b.max) { b.count++; b.total += bal; break }
    }
  }

  const sorted = [...buckets].sort((a, b) => b.total - a.total)
  const grandTotal = buckets.reduce((s, b) => s + b.total, 0)
  const grandCount = buckets.reduce((s, b) => s + b.count, 0)

  return (
    <WidgetCard
      title="Overdue Invoices Aging"
      span={6}
      action={
        <span className="text-xs tabular-nums text-gray-500">
          {grandCount} invoice{grandCount === 1 ? '' : 's'} · {formatCents(grandTotal)}
        </span>
      }
    >
      {grandCount === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No overdue invoices. Nice.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sorted.map((b) => (
            <li key={b.label}>
              <Link
                href={`/dashboard/${orgSlug}/reports/invoices`}
                className="flex items-center justify-between py-2 hover:bg-gray-50 rounded px-2 -mx-2"
              >
                <span className="text-sm font-semibold text-[#1A1A1A]">{b.label}</span>
                <span className="text-xs text-gray-500">{b.count} invoice{b.count === 1 ? '' : 's'}</span>
                <span className="text-sm font-bold tabular-nums text-[#1A1A1A]">{formatCents(b.total)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  )
}
