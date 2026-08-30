import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { formatQuoteNumber, formatSoNumber, formatCents } from '../../quotes/format'
import { formatInvNumber } from '../../invoices/format'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import { unstable_rethrow } from 'next/navigation'
import SendReceiptButton from '@/components/payments/send-receipt-button'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function PaymentDetailPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('payment-detail', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const payment = await dbOrThrow(
    supabase
      .from('payments')
      .select(
        'id, payment_number, amount_paid, applied, refunded_amount, balance, payment_method, ' +
        'check_number, card_last4, card_brand, paid_on, note, created_at, is_posted, ' +
        'customers(first_name, last_name, company_name, email)'
      )
      .eq('id', id)
      .eq('organization_id', org.id)
      .maybeSingle()
  ) as {
    id: string; payment_number: number; amount_paid: number; applied: number; refunded_amount: number; balance: number
    payment_method: string; check_number: string | null; card_last4: string | null; card_brand: string | null
    paid_on: string | null; note: string | null; created_at: string; is_posted: boolean
    customers: { first_name: string; last_name: string; company_name: string | null; email: string | null } | null
  } | null
  if (!payment) return <div className="p-8 text-red-600">Payment not found</div>

  type AppRow = {
    id: string; amount_applied: number; applied_at: string
    quote_id: string | null; sales_order_id: string | null; invoice_id: string | null
  }
  const applications = (await dbOrThrow(
    supabase
      .from('payment_applications')
      .select('id, amount_applied, applied_at, quote_id, sales_order_id, invoice_id')
      .eq('payment_id', payment.id)
      .order('applied_at')
  ) ?? []) as AppRow[]

  // Resolve each application's target display label + link. Three
  // small lookups instead of a generic join, since payment_applications
  // uses real FK columns (migration 160), not a polymorphic type/id
  // pair -- there's no single joinable "target" relation to ask for.
  const quoteIds = applications.filter((a) => a.quote_id).map((a) => a.quote_id!)
  const soIds = applications.filter((a) => a.sales_order_id).map((a) => a.sales_order_id!)
  const invIds = applications.filter((a) => a.invoice_id).map((a) => a.invoice_id!)

  const [quotes, sos, invs] = await Promise.all([
    quoteIds.length
      ? dbOrThrow(supabase.from('quotes').select('id, quote_number, created_at').in('id', quoteIds))
      : Promise.resolve([]),
    soIds.length
      ? dbOrThrow(supabase.from('sales_orders').select('id, so_number, created_at').in('id', soIds))
      : Promise.resolve([]),
    invIds.length
      ? dbOrThrow(supabase.from('invoices').select('id, invoice_number, created_at').in('id', invIds))
      : Promise.resolve([]),
  ]) as [
    { id: string; quote_number: number; created_at: string }[],
    { id: string; so_number: number; created_at: string }[],
    { id: string; invoice_number: number; created_at: string }[],
  ]
  const quoteById = new Map(quotes.map((q) => [q.id, q]))
  const soById = new Map(sos.map((s) => [s.id, s]))
  const invById = new Map(invs.map((i) => [i.id, i]))

  function targetLabelAndHref(a: AppRow): { label: string; href: string } | null {
    if (a.quote_id) {
      const q = quoteById.get(a.quote_id)
      return q ? { label: formatQuoteNumber(q.quote_number, q.created_at), href: `/dashboard/${slug}/quotes/${a.quote_id}` } : null
    }
    if (a.sales_order_id) {
      const s = soById.get(a.sales_order_id)
      return s ? { label: formatSoNumber(s.so_number, s.created_at), href: `/dashboard/${slug}/sales-orders/${a.sales_order_id}` } : null
    }
    if (a.invoice_id) {
      const i = invById.get(a.invoice_id)
      return i ? { label: formatInvNumber(i.invoice_number, i.created_at), href: `/dashboard/${slug}/invoices/${a.invoice_id}` } : null
    }
    return null
  }

  const customerName = payment.customers?.company_name
    ?? (payment.customers ? `${payment.customers.first_name} ${payment.customers.last_name}`.trim() : 'Unknown customer')

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <span className="text-gray-700">Payment #{payment.payment_number}</span>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Payment #{payment.payment_number}</h1>
          <p className="mt-1 text-sm text-gray-500">{customerName}</p>
        </div>
        <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${payment.is_posted ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
          {payment.is_posted ? 'Posted' : 'Unposted'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Summary</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Amount Paid</span>
              <span className="font-medium text-gray-900">${formatCents(payment.amount_paid)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Applied</span>
              <span className="font-medium text-gray-900">${formatCents(payment.applied)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Refunded</span>
              <span className="font-medium text-gray-900">${formatCents(payment.refunded_amount)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-3">
              <span className="font-semibold text-gray-900">Balance (Unapplied)</span>
              <span className={`font-extrabold ${payment.balance > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                ${formatCents(payment.balance)}
              </span>
            </div>
          </div>

          <div className="mt-4 border-t border-gray-100 pt-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Payment Method</span><span className="text-gray-900">{payment.payment_method}</span></div>
            {payment.check_number && (
              <div className="flex justify-between"><span className="text-gray-500">Check Number</span><span className="text-gray-900">{payment.check_number}</span></div>
            )}
            {payment.card_last4 && (
              <div className="flex justify-between"><span className="text-gray-500">Card</span><span className="text-gray-900">{payment.card_brand} •••• {payment.card_last4}</span></div>
            )}
            <div className="flex justify-between"><span className="text-gray-500">Paid On</span><span className="text-gray-900">{payment.paid_on ?? '—'}</span></div>
            {payment.note && (
              <div><span className="text-gray-500">Note</span><p className="mt-1 text-gray-900">{payment.note}</p></div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Applied To</h2>
            {applications.length === 0 ? (
              <p className="text-sm text-gray-500">Unapplied — not yet allocated to a quote, sales order, or invoice.</p>
            ) : (
              <div className="space-y-2">
                {applications.map((a) => {
                  const target = targetLabelAndHref(a)
                  return (
                    <div key={a.id} className="flex justify-between text-sm">
                      {target ? (
                        <Link href={target.href} className="text-qm-fuchsia hover:underline">{target.label}</Link>
                      ) : (
                        <span className="text-gray-400">(deleted)</span>
                      )}
                      <span className="tabular-nums text-gray-900">${formatCents(a.amount_applied)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-4">Receipt</h2>
            <SendReceiptButton paymentId={payment.id} orgId={org.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
