import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { formatInvNumber, formatCents, INV_STATUS_STYLES, INV_STATUS_LABELS } from '../format'
import { recordPayment } from './actions'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const { data: invRow } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, subtotal, tax_total, total, amount_paid, balance_due, due_date, notes, sales_order_id, customer_id, created_at, customers(first_name, last_name, company_name, email)')
    .eq('id', id)
    .eq('organization_id', org.id)
    .single()
  const inv = invRow as {
    id: string; invoice_number: number; status: string
    subtotal: number; tax_total: number; total: number; amount_paid: number; balance_due: number
    due_date: string | null; notes: string | null; sales_order_id: string | null
    customer_id: string | null; created_at: string
    customers: { first_name: string; last_name: string; company_name: string | null; email: string | null } | null
  } | null
  if (!inv) return <div className="p-8 text-red-600">Invoice not found</div>

  // SO reference
  let soNum: number | null = null
  if (inv.sales_order_id) {
    const { data: so } = await supabase.from('sales_orders').select('so_number').eq('id', inv.sales_order_id).single()
    soNum = (so as { so_number: number } | null)?.so_number ?? null
  }

  // Line items from the linked quote (via SO → quote)
  type LineItem = { description: string; quantity: number; unit_price: number; total_price: number }
  let lineItems: LineItem[] = []
  if (inv.sales_order_id) {
    const { data: soRow } = await supabase.from('sales_orders').select('quote_id').eq('id', inv.sales_order_id).single()
    const quoteId = (soRow as { quote_id: string | null } | null)?.quote_id
    if (quoteId) {
      const { data: li } = await supabase.from('quote_line_items').select('description, quantity, unit_price, total_price').eq('quote_id', quoteId).order('sort_order')
      lineItems = (li ?? []) as LineItem[]
    }
  }

  const invNum = formatInvNumber(inv.invoice_number, inv.created_at)

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/invoices`} className="hover:text-gray-700">Invoices</Link>
        <span>/</span>
        <span className="text-gray-700">{invNum}</span>
      </div>

      {/* Header */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">{invNum}</h1>
            {inv.customers && (
              <p className="mt-1 text-sm text-gray-600">
                {inv.customers.first_name} {inv.customers.last_name}
                {inv.customers.company_name && <span className="text-gray-400"> &mdash; {inv.customers.company_name}</span>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${INV_STATUS_STYLES[inv.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {INV_STATUS_LABELS[inv.status] ?? inv.status}
            </span>
            <a
              href={`/api/invoices/${inv.id}/export-iif`}
              className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              Export to QuickBooks
            </a>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-6 text-sm">
          {inv.sales_order_id && soNum && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Sales Order </span>
              <Link href={`/dashboard/${slug}/sales-orders/${inv.sales_order_id}`} className="text-qm-fuchsia hover:underline font-semibold">
                SO-{String(soNum).padStart(4, '0')}
              </Link>
            </div>
          )}
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Created </span>
            <span className="text-gray-700">{new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          </div>
          {inv.due_date && (
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Due </span>
              <span className="text-gray-700">{new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500">Line Items</h2>
        </div>
        {lineItems.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">No line items.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Description</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Qty</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Unit Price</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lineItems.map((li, i) => (
                <tr key={i}>
                  <td className="px-6 py-3 text-sm text-gray-900">{li.description}</td>
                  <td className="px-6 py-3 text-sm text-gray-900 text-right tabular-nums">{li.quantity}</td>
                  <td className="px-6 py-3 text-sm text-gray-900 text-right tabular-nums">${formatCents(li.unit_price)}</td>
                  <td className="px-6 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">${formatCents(li.total_price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={3} className="px-6 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Subtotal</td>
                <td className="px-6 py-2 text-right text-sm tabular-nums text-gray-900">${formatCents(inv.subtotal)}</td>
              </tr>
              {inv.tax_total > 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500">Tax</td>
                  <td className="px-6 py-2 text-right text-sm tabular-nums text-gray-900">${formatCents(inv.tax_total)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="px-6 py-2 text-right text-sm font-bold text-gray-900">Total</td>
                <td className="px-6 py-2 text-right text-base font-extrabold tabular-nums text-gray-900">${formatCents(inv.total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Payment summary + Record Payment */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Payment Summary</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Total</span>
              <span className="font-medium text-gray-900">${formatCents(inv.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Amount Paid</span>
              <span className="font-medium text-green-700">${formatCents(inv.amount_paid)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-3">
              <span className="font-semibold text-gray-900">Balance Due</span>
              <span className={`font-extrabold ${inv.balance_due > 0 ? 'text-red-600' : 'text-green-600'}`}>
                ${formatCents(inv.balance_due)}
              </span>
            </div>
          </div>
        </div>

        {inv.balance_due > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Record Payment</h2>
            <form action={recordPayment}>
              <input type="hidden" name="invoiceId" value={inv.id} />
              <input type="hidden" name="orgSlug" value={slug} />
              <div>
                <label className="block text-sm font-medium text-gray-700">Amount ($)</label>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0.01"
                  max={(inv.balance_due / 100).toFixed(2)}
                  defaultValue={(inv.balance_due / 100).toFixed(2)}
                  required
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>
              <button type="submit" className="mt-3 rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
                Record Payment
              </button>
            </form>
          </div>
        )}
      </div>

      {inv.notes && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-2">Notes</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{inv.notes}</p>
        </div>
      )}
    </div>
  )
}
