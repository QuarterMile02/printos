// Quotes Needing Approval — manager-tier queue. Tries the rich filter
// (needs_manager_approval = true) first; if the column doesn't exist,
// falls back to status='pending' which is the closest semantic match
// in the live quote_status enum.

import Link from 'next/link'
import WidgetCard from './widget-card'
import QuoteApproveButton from './quote-approve-button'
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
  total: number | null
  notes: string | null
  created_at: string
  sales_rep_id: string | null
  customers: { first_name: string | null; last_name: string | null; company_name: string | null } | null
}

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—'
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function customerLabel(c: QuoteRow['customers']): string {
  if (!c) return '—'
  return c.company_name ?? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() ?? '—'
}
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

export default async function QuotesNeedingApproval({ service, orgId, orgSlug }: Props) {
  const select = 'id, quote_number, total, notes, created_at, sales_rep_id, customers(first_name, last_name, company_name)'
  let rows: QuoteRow[] = []
  let errorMsg: string | null = null

  // Try the rich filter first; on missing column, fall back to status.
  try {
    const r = await service
      .from('quotes')
      .select(select)
      .eq('organization_id', orgId)
      .eq('needs_manager_approval', true)
      .order('created_at', { ascending: true })
      .limit(15)
    if (r.error) {
      if (/column .*needs_manager_approval.* does not exist/i.test(r.error.message)) {
        const fb = await service
          .from('quotes')
          .select(select)
          .eq('organization_id', orgId)
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(15)
        if (fb.error) {
          console.error('[quotes-needing-approval] fallback failed:', fb.error)
          errorMsg = fb.error.message
        } else {
          rows = (fb.data ?? []) as unknown as QuoteRow[]
        }
      } else {
        console.error('[quotes-needing-approval] query failed:', r.error)
        errorMsg = r.error.message
      }
    } else {
      rows = (r.data ?? []) as unknown as QuoteRow[]
    }
  } catch (err) {
    if (!errorMsg && err instanceof Error) errorMsg = err.message
  }

  // Resolve sales rep names
  const repIds = [...new Set(rows.map(r => r.sales_rep_id).filter(Boolean) as string[])]
  const nameMap = new Map<string, string>()
  if (repIds.length > 0) {
    try {
      const tm = await service
        .from('team_members')
        .select('user_id, full_name, first_name, last_name')
        .in('user_id', repIds)
      if (!tm.error) {
        for (const m of (tm.data ?? []) as { user_id: string; full_name: string | null; first_name: string | null; last_name: string | null }[]) {
          const composed = m.full_name ?? [m.first_name, m.last_name].filter(Boolean).join(' ').trim()
          if (composed) nameMap.set(m.user_id, composed)
        }
      }
    } catch { /* fall through to profiles */ }
    const stillMissing = repIds.filter(id => !nameMap.has(id))
    if (stillMissing.length > 0) {
      try {
        const pf = await service.from('profiles').select('id, full_name, email').in('id', stillMissing)
        if (!pf.error) {
          for (const p of (pf.data ?? []) as { id: string; full_name: string | null; email: string | null }[]) {
            const composed = p.full_name || p.email
            if (composed) nameMap.set(p.id, composed)
          }
        }
      } catch { /* fall back to id prefix */ }
    }
  }

  return (
    <WidgetCard title="Quotes Needing Approval" span={6}>
      {errorMsg ? (
        <div className="py-6 text-center text-sm text-gray-400">
          <p>Unable to load</p>
          <p className="mt-1 text-xs text-red-500 font-mono">{errorMsg}</p>
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-green-700">✅ No quotes waiting for approval</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((q) => {
            const year = new Date(q.created_at).getFullYear()
            const num = `Q-${year}-${String(q.quote_number).padStart(4, '0')}`
            const days = daysSince(q.created_at)
            const repName = q.sales_rep_id
              ? nameMap.get(q.sales_rep_id) ?? `Rep ${q.sales_rep_id.slice(0, 6)}…`
              : '—'
            return (
              <li key={q.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      <span className="font-semibold text-[#93ca3b]">{num}</span>
                      <span className="text-gray-500"> · </span>
                      <span className="text-[#1A1A1A]">{customerLabel(q.customers)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      Rep: {repName} · {days}d waiting · {fmtMoney(q.total)}
                    </div>
                    {q.notes && <div className="mt-1 text-xs text-gray-600 line-clamp-2">{q.notes}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <QuoteApproveButton quoteId={q.id} organizationId={orgId} />
                    <Link
                      href={`/dashboard/${orgSlug}/quotes/${q.id}`}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Review
                    </Link>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
