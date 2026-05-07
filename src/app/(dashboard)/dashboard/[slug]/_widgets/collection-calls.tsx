// Collection Calls — accounting-priority widget that lists customers
// with overdue invoices, sorted by total owed. Each row exposes an
// inline "Log Call" form (client island) that posts to
// /api/collection-calls.
//
// Grouping happens in JS to avoid PostgREST DISTINCT ON / aggregate
// limitations: pull invoices + joined customer, then aggregate per
// customer_id.

import Link from 'next/link'
import WidgetCard from './widget-card'
import CollectionCallForm from './collection-call-form'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

type InvoiceRow = {
  id: string
  total: number | null
  balance_due: number | null
  due_date: string | null
  customer_id: string | null
  customers: {
    first_name: string | null
    last_name: string | null
    company_name: string | null
    phone: string | null
    email: string | null
  } | null
}

type CustomerRollup = {
  customerId: string
  name: string
  phone: string | null
  email: string | null
  totalOwedCents: number
  invoiceCount: number
  oldestDueIso: string | null
}

function fmtMoney(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function customerLabel(c: InvoiceRow['customers']): string {
  if (!c) return 'Unknown customer'
  return c.company_name ?? `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() ?? 'Unknown customer'
}

export default async function CollectionCalls({ service, orgId, orgSlug }: Props) {
  const todayDate = new Date().toISOString().slice(0, 10)
  let rows: InvoiceRow[] | null = null
  let errorMsg: string | null = null
  try {
    const r = await service
      .from('invoices')
      .select('id, total, balance_due, due_date, customer_id, customers(first_name, last_name, company_name, phone, email)')
      .eq('organization_id', orgId)
      .not('status', 'in', '("paid","cancelled","draft")')
      .lt('due_date', todayDate)
      .limit(2000)
    if (r.error) {
      console.error('[collection-calls] invoices query failed:', r.error)
      errorMsg = r.error.message
      throw r.error
    }
    rows = (r.data ?? []) as unknown as InvoiceRow[]
  } catch (err) {
    if (!errorMsg && err instanceof Error) errorMsg = err.message
    rows = null
  }

  if (rows === null) {
    return (
      <WidgetCard title="Collection Calls" span={6}>
        <div className="py-6 text-center text-sm text-gray-400">
          <p>Unable to load</p>
          {errorMsg && <p className="mt-1 text-xs text-red-500 font-mono">{errorMsg}</p>}
        </div>
      </WidgetCard>
    )
  }

  // Group by customer_id
  const byCustomer = new Map<string, CustomerRollup>()
  for (const inv of rows) {
    if (!inv.customer_id) continue
    const owed = Number(inv.balance_due ?? inv.total ?? 0)
    if (owed <= 0) continue
    const existing = byCustomer.get(inv.customer_id)
    if (existing) {
      existing.totalOwedCents += owed
      existing.invoiceCount++
      if (inv.due_date && (!existing.oldestDueIso || inv.due_date < existing.oldestDueIso)) {
        existing.oldestDueIso = inv.due_date
      }
    } else {
      byCustomer.set(inv.customer_id, {
        customerId: inv.customer_id,
        name: customerLabel(inv.customers),
        phone: inv.customers?.phone ?? null,
        email: inv.customers?.email ?? null,
        totalOwedCents: owed,
        invoiceCount: 1,
        oldestDueIso: inv.due_date ?? null,
      })
    }
  }

  const customers = [...byCustomer.values()]
    .sort((a, b) => b.totalOwedCents - a.totalOwedCents)
    .slice(0, 20)

  return (
    <WidgetCard title="Collection Calls" span={6}>
      {customers.length === 0 ? (
        <p className="py-6 text-center text-sm text-green-700">✓ No overdue invoices</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {customers.map((c) => {
            const tone = c.totalOwedCents > 100_000 // > $1000 in cents
              ? 'text-[#ee2b7b]'
              : 'text-amber-600'
            return (
              <li key={c.customerId} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/${orgSlug}/customers/${c.customerId}`}
                      className="text-sm font-bold text-[#1A1A1A] hover:text-[#93ca3b] truncate block"
                    >
                      {c.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {c.invoiceCount} invoice{c.invoiceCount === 1 ? '' : 's'} · oldest due {fmtDate(c.oldestDueIso)}
                      {c.phone && <> · <span className="text-gray-700">{c.phone}</span></>}
                    </div>
                  </div>
                  <div className={`text-base font-extrabold tabular-nums whitespace-nowrap ${tone}`}>
                    {fmtMoney(c.totalOwedCents)}
                  </div>
                  <CollectionCallForm
                    customerId={c.customerId}
                    organizationId={orgId}
                    customerName={c.name}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
