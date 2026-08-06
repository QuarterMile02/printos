import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string; orgSlug: string }

// Note: 'void' is a Sales Order status, not a Quote status — it isn't a
// member of the quote_status enum, so including it here made Postgres
// reject the whole query ("invalid input value for enum quote_status").
const EXCLUDED = ['ordered', 'expired', 'lost', 'no_charge']

const STATUS_STYLES: Record<string, string> = {
  draft:                'bg-gray-100 text-gray-600',
  delivered:            'bg-blue-50 text-blue-700',
  customer_review:      'bg-amber-50 text-amber-700',
  approved:             'bg-green-50 text-green-700',
  internally_approved:  'bg-green-100 text-green-800',
  approve_with_changes: 'bg-teal-50 text-teal-700',
  revise:               'bg-orange-50 text-orange-700',
  hold:                 'bg-orange-100 text-orange-800',
  pending:              'bg-gray-100 text-gray-600',
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function formatDollars(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

type QuoteRow = {
  id: string
  quote_number: number
  title: string
  total: number | null
  status: string
  created_at: string
  customer_id: string | null
  customers: { company_name: string | null; first_name: string; last_name: string } | null
}

export default async function QuotesPriorityWidget({ service, orgId, orgSlug }: Props) {
  try {
    const { data, error } = await service
      .from('quotes')
      .select('id, quote_number, title, total, status, created_at, customer_id')
      .eq('organization_id', orgId)
      .not('status', 'in', `(${EXCLUDED.join(',')})`)
      .order('total', { ascending: false, nullsFirst: false })
      .limit(10) as { data: Omit<QuoteRow, 'customers'>[] | null; error: unknown }

    if (error) {
      console.error('[quotes-priority] query error:', error)
      throw new Error()
    }
    if (!data) throw new Error()

    // Fetch customers separately (avoids PostgREST join brittleness)
    const customerIds = [...new Set(data.map(q => q.customer_id).filter((id): id is string => !!id))]
    const custMap = new Map<string, { company_name: string | null; first_name: string; last_name: string }>()
    if (customerIds.length > 0) {
      const { data: custs } = await service
        .from('customers')
        .select('id, company_name, first_name, last_name')
        .in('id', customerIds) as {
          data: { id: string; company_name: string | null; first_name: string; last_name: string }[] | null
          error: unknown
        }
      for (const c of custs ?? []) {
        custMap.set(c.id, { company_name: c.company_name, first_name: c.first_name, last_name: c.last_name })
      }
    }
    const rows: QuoteRow[] = data.map(q => ({
      ...q,
      customers: q.customer_id ? (custMap.get(q.customer_id) ?? null) : null,
    }))

    return (
      <WidgetCard title="Quotes Priority" span={6}>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">No open quotes</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Quote</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Customer</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Amount</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Age</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((q) => {
                  const year = new Date(q.created_at).getFullYear()
                  const num  = `Q-${year}-${String(q.quote_number).padStart(4, '0')}`
                  const cust = q.customers
                    ? q.customers.company_name || `${q.customers.first_name} ${q.customers.last_name}`
                    : '—'
                  const days = daysSince(q.created_at)
                  return (
                    <tr key={q.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-[#93ca3b]">
                        <Link href={`/dashboard/${orgSlug}/quotes/${q.id}`}>{num}</Link>
                      </td>
                      <td className="max-w-[120px] truncate px-3 py-2 text-gray-700">{cust}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-[#1A1A1A]">
                        {q.total != null ? formatDollars(q.total) : '—'}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right text-xs font-medium ${
                        days >= 14 ? 'text-red-600' : days >= 7 ? 'text-amber-600' : 'text-gray-400'
                      }`}>
                        {days}d
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[q.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {q.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </WidgetCard>
    )
  } catch {
    return (
      <WidgetCard title="Quotes Priority" span={6}>
        <p className="text-sm text-gray-400">Unable to load</p>
      </WidgetCard>
    )
  }
}
