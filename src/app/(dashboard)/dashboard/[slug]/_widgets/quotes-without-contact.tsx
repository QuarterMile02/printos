// Quotes Without Contact — open quotes that have no customer linked.
// Lets sales reps spot drafts where they forgot to attach a customer.

import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

type QuoteRow = {
  id: string
  quote_number: number
  title: string | null
  status: string
  created_at: string
  total: number | null
}

// Whitelist of "still open" quote_status enum values (verified in migrations
// 002 and 018a). The original spec asked for NOT IN cancelled/invoiced/paid/
// completed, but those are NOT members of the quote_status enum — passing
// them to PostgREST raises "invalid input value for enum" and crashes the
// query. We invert the filter and IN-list valid open statuses instead.
const OPEN_STATUSES = [
  'draft', 'sent', 'delivered', 'customer_review', 'approve_with_changes',
  'revise', 'hold', 'pending', 'approved',
]

const STATUS_STYLES: Record<string, string> = {
  draft:                'bg-gray-100 text-gray-600',
  sent:                 'bg-blue-50 text-blue-700',
  delivered:            'bg-blue-50 text-blue-700',
  customer_review:      'bg-amber-50 text-amber-700',
  approve_with_changes: 'bg-teal-50 text-teal-700',
  revise:               'bg-orange-50 text-orange-700',
  approved:             'bg-green-50 text-green-700',
  pending:              'bg-gray-100 text-gray-600',
  hold:                 'bg-orange-100 text-orange-800',
}

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function truncate(s: string | null, n: number): string {
  if (!s) return '(untitled)'
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export default async function QuotesWithoutContact({ service, orgId, orgSlug }: Props) {
  let rows: QuoteRow[] | null = null
  let errorMsg: string | null = null
  try {
    const r = await service
      .from('quotes')
      .select('id, quote_number, title, status, created_at, total, customer_id')
      .eq('organization_id', orgId)
      .is('customer_id', null)
      .in('status', OPEN_STATUSES)
      .order('created_at', { ascending: false })
      .limit(20)
    if (r.error) {
      console.error('[quotes-without-contact] query failed:', r.error)
      errorMsg = r.error.message
      throw r.error
    }
    rows = (r.data ?? []) as QuoteRow[]
  } catch (err) {
    console.error('[quotes-without-contact] crash:', err)
    if (!errorMsg && err instanceof Error) errorMsg = err.message
    rows = null
  }

  return (
    <WidgetCard
      title="Quotes Without Contact"
      span={6}
      action={
        <Link href={`/dashboard/${orgSlug}/quotes`} className="text-xs font-medium text-[#93ca3b] hover:underline">
          View all quotes →
        </Link>
      }
    >
      {rows === null ? (
        <div className="py-6 text-center text-sm text-gray-400">
          <p>Unable to load</p>
          {errorMsg && <p className="mt-1 text-xs text-red-500 font-mono">{errorMsg}</p>}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">✅ All quotes have customer contact info</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((q) => {
            const year = new Date(q.created_at).getFullYear()
            const num = `Q-${year}-${String(q.quote_number).padStart(4, '0')}`
            const created = new Date(q.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            return (
              <li key={q.id}>
                <Link
                  href={`/dashboard/${orgSlug}/quotes/${q.id}`}
                  className="flex items-center justify-between gap-3 py-2 px-2 -mx-2 rounded hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#93ca3b]">{num}</div>
                    <div className="text-xs text-gray-600 truncate">{truncate(q.title, 40)}</div>
                  </div>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{created}</span>
                  <span className="text-sm font-semibold tabular-nums text-[#1A1A1A] whitespace-nowrap">
                    {fmtMoney(q.total)}
                  </span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {q.status.replace(/_/g, ' ')}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
