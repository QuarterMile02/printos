import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { REPORT_DEFS } from '@/lib/reports/report-utils'

type PageProps = { params: Promise<{ slug: string }> }

export const dynamic = 'force-dynamic'

type Bucket = {
  key: '0-30' | '31-60' | '61-90' | '90+'
  label: string
  borderColor: string
  count: number
  totalCents: number
}

function fmtMoney(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function ageInDays(dueIso: string | null): number {
  if (!dueIso) return -1
  const due = new Date(dueIso.length === 10 ? dueIso + 'T00:00:00' : dueIso).getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - due) / 86_400_000)
}

async function loadAgingBuckets(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<Bucket[] | null> {
  try {
    // invoices.total / balance_due are integer cents per migration 026.
    // Exclude paid/cancelled/draft using the in-list syntax PostgREST
    // accepts for text columns (invoices.status is text, not an enum).
    const r = await supabase
      .from('invoices')
      .select('id, total, balance_due, due_date')
      .eq('organization_id', orgId)
      .not('status', 'in', '("paid","cancelled","draft")')
      .lt('due_date', new Date().toISOString().slice(0, 10))
      .limit(1000)
    if (r.error) {
      console.error('[reports/index] invoices aging query failed:', r.error)
      return null
    }
    const buckets: Bucket[] = [
      { key: '0-30',  label: '0-30 days',  borderColor: '#93ca3b', count: 0, totalCents: 0 },
      { key: '31-60', label: '31-60 days', borderColor: '#fbbf24', count: 0, totalCents: 0 },
      { key: '61-90', label: '61-90 days', borderColor: '#fb923c', count: 0, totalCents: 0 },
      { key: '90+',   label: '90+ days',   borderColor: '#ee2b7b', count: 0, totalCents: 0 },
    ]
    for (const row of (r.data ?? []) as { due_date: string | null; balance_due: number | null }[]) {
      const age = ageInDays(row.due_date)
      if (age < 1) continue
      const bal = Number(row.balance_due ?? 0)
      if (bal <= 0) continue
      if (age <= 30) { buckets[0].count++; buckets[0].totalCents += bal }
      else if (age <= 60) { buckets[1].count++; buckets[1].totalCents += bal }
      else if (age <= 90) { buckets[2].count++; buckets[2].totalCents += bal }
      else { buckets[3].count++; buckets[3].totalCents += bal }
    }
    return buckets
  } catch (err) {
    console.error('[reports/index] invoices aging crash:', err)
    return null
  }
}

export default async function ReportsIndex({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .maybeSingle() as { data: { id: string; name: string } | null; error: unknown }
  if (!org) notFound()

  // Anyone with reports.quotes (owner/sales/accounting) can land here.
  const { allowed } = await checkPermission(org.id, 'reports.quotes')
  if (!allowed) notFound()

  const buckets = await loadAgingBuckets(supabase, org.id)

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[#1A1A1A]">Reports</h1>
        <p className="mt-1 text-sm text-gray-600">
          Pick a report to drill into. Each opens with a date-range filter, sortable columns, and a CSV export.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 items-start">
        {REPORT_DEFS.map((r) => {
          if (r.type === 'invoices') {
            return (
              <InvoicesAgingCard
                key={r.type}
                href={`/dashboard/${slug}/reports/${r.type}`}
                title={r.title}
                fallbackDescription={r.description}
                buckets={buckets}
              />
            )
          }
          return (
            <Link
              key={r.type}
              href={`/dashboard/${slug}/reports/${r.type}`}
              className="group rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-[#93ca3b] hover:shadow-md"
            >
              <h2 className="text-base font-bold text-[#1A1A1A] group-hover:text-[#93ca3b]">{r.title}</h2>
              <p className="mt-1 text-sm text-gray-600">{r.description}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#93ca3b]">
                Open report
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function InvoicesAgingCard({
  href, title, fallbackDescription, buckets,
}: {
  href: string
  title: string
  fallbackDescription: string
  buckets: Bucket[] | null
}) {
  const allZero = buckets ? buckets.every((b) => b.count === 0) : false

  return (
    <Link
      href={href}
      className="group flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-[#93ca3b] hover:shadow-md"
    >
      <h2 className="text-base font-bold text-[#1A1A1A] group-hover:text-[#93ca3b]">{title}</h2>

      {buckets === null ? (
        <p className="mt-1 text-sm text-gray-600">{fallbackDescription}</p>
      ) : allZero ? (
        <p className="mt-2 text-sm font-medium text-green-700">✅ No overdue invoices</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {buckets.map((b) => (
            <li
              key={b.key}
              className="flex items-center justify-between gap-2 rounded bg-gray-50 border-l-[3px] px-2 py-1.5 text-xs"
              style={{ borderLeftColor: b.borderColor }}
            >
              <span className="font-semibold text-[#1A1A1A] w-20">{b.label}</span>
              <span className="text-gray-500 tabular-nums w-20 text-right">
                {b.count} inv{b.count === 1 ? '.' : 's.'}
              </span>
              <span className="font-bold tabular-nums text-[#1A1A1A] flex-1 text-right">
                {fmtMoney(b.totalCents)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#93ca3b]">
        Open report
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
        </svg>
      </span>
    </Link>
  )
}
