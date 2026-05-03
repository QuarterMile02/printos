import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string; orgSlug: string }

type InvoiceRow = {
  id: string
  invoice_number: number
  balance_due: number | null
  due_date: string | null
  status: string
  customers: { company_name: string | null; first_name: string; last_name: string } | null
}

function formatDollars(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function daysOverdue(dueDate: string): number {
  const due = new Date(dueDate + 'T00:00:00').getTime()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - due) / 86_400_000))
}

export default async function CollectionCallWidget({ service, orgId, orgSlug }: Props) {
  const todayDate = new Date().toISOString().slice(0, 10)

  try {
    const { data, error } = await service
      .from('invoices')
      .select('id, invoice_number, balance_due, due_date, status, customers(company_name, first_name, last_name)')
      .eq('organization_id', orgId)
      .in('status', ['sent', 'partial', 'overdue'])
      .not('due_date', 'is', null)
      .lt('due_date', todayDate)
      .order('due_date', { ascending: true }) as { data: InvoiceRow[] | null; error: unknown }

    if (error || !data) throw new Error()

    // Sort most overdue first
    const sorted = [...data].sort((a, b) => {
      const da = a.due_date ? daysOverdue(a.due_date) : 0
      const db = b.due_date ? daysOverdue(b.due_date) : 0
      return db - da
    })

    return (
      <WidgetCard title="Collection Calls" span={6}>
        {sorted.length === 0 ? (
          <p className="text-sm text-green-600 font-medium">✓ No overdue invoices</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Invoice</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Customer</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Due</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sorted.map((inv) => {
                  const overdue = inv.due_date ? daysOverdue(inv.due_date) : 0
                  const cust = inv.customers
                    ? inv.customers.company_name || `${inv.customers.first_name} ${inv.customers.last_name}`
                    : '—'
                  const dueLabel = inv.due_date
                    ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '—'
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-[#93ca3b]">
                        <Link href={`/dashboard/${orgSlug}/invoices/${inv.id}`}>
                          INV-{String(inv.invoice_number).padStart(4, '0')}
                        </Link>
                      </td>
                      <td className="max-w-[120px] truncate px-3 py-2 text-gray-700">{cust}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-[#1A1A1A]">
                        {inv.balance_due != null ? formatDollars(inv.balance_due) : '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{dueLabel}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right text-xs font-semibold ${
                        overdue >= 30 ? 'text-red-600' : overdue >= 14 ? 'text-amber-600' : 'text-orange-500'
                      }`}>
                        {overdue}d
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
      <WidgetCard title="Collection Calls" span={6}>
        <p className="text-sm text-gray-400">Unable to load</p>
      </WidgetCard>
    )
  }
}
