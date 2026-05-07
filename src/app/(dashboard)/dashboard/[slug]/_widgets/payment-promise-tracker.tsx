// Payment Promise Tracker — surface every "Payment promised by date"
// outcome from collection_call_logs in the last 30 days, and check
// whether the customer has actually paid since the promise was made.
//
// If collection_call_logs doesn't exist (migration 048 not applied),
// the try/catch falls through to an empty-state card.

import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

type PromiseRow = {
  id: string
  customer_id: string | null
  promise_date: string | null
  notes: string | null
  logged_at: string | null
}

type CustomerRow = {
  id: string
  first_name: string | null
  last_name: string | null
  company_name: string | null
}

type InvoicePayment = {
  customer_id: string | null
  amount_paid: number | null
  status: string | null
  updated_at: string | null
}

type PromiseStatus = 'paid' | 'pending' | 'overdue' | 'today'

function customerLabel(c: CustomerRow | undefined): string {
  if (!c) return 'Unknown customer'
  return c.company_name ?? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() ?? 'Unknown customer'
}

function todayIso(): string { return new Date().toISOString().slice(0, 10) }

function promiseTone(status: PromiseStatus): { label: string; cls: string } {
  switch (status) {
    case 'paid':    return { label: '✅ Paid',     cls: 'text-green-700' }
    case 'overdue': return { label: '🔴 Overdue',  cls: 'text-red-600 font-semibold' }
    case 'today':   return { label: '⏰ Due Today', cls: 'text-amber-600 font-semibold' }
    case 'pending': return { label: '⏳ Pending',  cls: 'text-gray-600' }
  }
}

function parsePromisedAmount(notes: string | null): string | null {
  if (!notes) return null
  // Look for "$1,234" or "$1234.56" first; fall back to bare numeric
  // amounts adjacent to a dollar sign.
  const m = notes.match(/\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/)
  if (!m) return null
  return '$' + m[1]
}

export default async function PaymentPromiseTracker({ service, orgId, orgSlug }: Props) {
  const today = todayIso()
  const since = new Date(); since.setDate(since.getDate() - 30); since.setHours(0, 0, 0, 0)
  const sinceIso = since.toISOString().slice(0, 10)

  let promises: PromiseRow[] | null = null
  try {
    const r = await service
      .from('collection_call_logs')
      .select('id, customer_id, promise_date, notes, logged_at')
      .eq('organization_id', orgId)
      .eq('outcome', 'Payment promised by date')
      .gte('promise_date', sinceIso)
      .order('promise_date', { ascending: true })
      .limit(50)
    if (r.error) {
      console.warn('[payment-promise-tracker] collection_call_logs missing or query failed:', r.error.message)
      promises = null
    } else {
      promises = (r.data ?? []) as PromiseRow[]
    }
  } catch (err) {
    console.warn('[payment-promise-tracker] crash (likely missing table):', err)
    promises = null
  }

  if (promises === null || promises.length === 0) {
    return (
      <WidgetCard title="Payment Promise Tracker" span={6}>
        <p className="py-6 text-center text-sm text-gray-500">
          {promises === null ? 'No payment promises tracked yet' : '✅ No pending payment promises'}
        </p>
      </WidgetCard>
    )
  }

  // Resolve customers and recent invoice activity in parallel.
  const customerIds = [...new Set(promises.map(p => p.customer_id).filter(Boolean) as string[])]
  let custMap = new Map<string, CustomerRow>()
  let payMap = new Map<string, InvoicePayment[]>()
  if (customerIds.length > 0) {
    const [custRes, invRes] = await Promise.all([
      service.from('customers').select('id, first_name, last_name, company_name').in('id', customerIds),
      service
        .from('invoices')
        .select('customer_id, amount_paid, status, updated_at')
        .in('customer_id', customerIds)
        .eq('organization_id', orgId)
        .gte('updated_at', sinceIso)
        .limit(2000),
    ])
    if (!custRes.error) {
      for (const c of (custRes.data ?? []) as CustomerRow[]) custMap.set(c.id, c)
    }
    if (!invRes.error) {
      for (const inv of (invRes.data ?? []) as InvoicePayment[]) {
        if (!inv.customer_id) continue
        const arr = payMap.get(inv.customer_id) ?? []
        arr.push(inv)
        payMap.set(inv.customer_id, arr)
      }
    }
  }

  function statusFor(p: PromiseRow): PromiseStatus {
    // If any of this customer's invoices were marked paid (status='paid'
    // or amount_paid > 0) AFTER the promise_date, treat as paid.
    if (p.customer_id && p.promise_date) {
      const invs = payMap.get(p.customer_id) ?? []
      const paidAfter = invs.some((inv) => {
        if (!inv.updated_at) return false
        if (inv.updated_at.slice(0, 10) < p.promise_date!) return false
        return inv.status === 'paid' || Number(inv.amount_paid ?? 0) > 0
      })
      if (paidAfter) return 'paid'
    }
    if (!p.promise_date) return 'pending'
    if (p.promise_date < today) return 'overdue'
    if (p.promise_date === today) return 'today'
    return 'pending'
  }

  return (
    <WidgetCard title="Payment Promise Tracker" span={6}>
      <ul className="divide-y divide-gray-100">
        {promises.map((p) => {
          const cust = p.customer_id ? custMap.get(p.customer_id) : undefined
          const name = customerLabel(cust)
          const status = statusFor(p)
          const tone = promiseTone(status)
          const promised = parsePromisedAmount(p.notes)
          const dateLabel = p.promise_date
            ? new Date(p.promise_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '—'
          return (
            <li key={p.id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                {p.customer_id ? (
                  <Link
                    href={`/dashboard/${orgSlug}/customers/${p.customer_id}`}
                    className="text-sm font-bold text-[#1A1A1A] hover:text-[#93ca3b] truncate block"
                  >
                    {name}
                  </Link>
                ) : (
                  <span className="text-sm font-bold text-[#1A1A1A]">{name}</span>
                )}
                <div className="text-xs text-gray-500">
                  Promise: <span className={tone.cls}>{dateLabel}</span> · Amount: {promised ?? '—'}
                </div>
              </div>
              <span className={`text-xs whitespace-nowrap ${tone.cls}`}>{tone.label}</span>
              {status === 'overdue' && p.customer_id && (
                <Link
                  href={`/dashboard/${orgSlug}/customers/${p.customer_id}`}
                  className="text-xs font-semibold text-[#ee2b7b] hover:underline whitespace-nowrap"
                >
                  Re-add to Call List →
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </WidgetCard>
  )
}
