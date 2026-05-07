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

const EXCLUDED = ['cancelled', 'invoiced', 'paid', 'completed']

const STATUS_STYLES: Record<string, string> = {
  draft:               'bg-gray-100 text-gray-600',
  delivered:           'bg-blue-50 text-blue-700',
  customer_review:     'bg-amber-50 text-amber-700',
  approved:            'bg-green-50 text-green-700',
  internally_approved: 'bg-green-100 text-green-800',
  pending:             'bg-gray-100 text-gray-600',
  hold:                'bg-orange-100 text-orange-800',
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
  try {
    const r = await service
      .from('quotes')
      .select('id, quote_number, title, status, created_at, total')
      .eq('organization_id', orgId)
      .is('customer_id', null)
      .not('status', 'in', `(${EXCLUDED.map(s => `"${s}"`).join(',')})`)
      .order('created_at', { ascending: false })
      .limit(20)
    if (r.error) throw r.error
    rows = (r.data ?? []) as QuoteRow[]
  } catch {
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
        <p className="py-6 text-center text-sm text-gray-400">Unable to load</p>
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
