import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { formatInvNumber, formatCents, INV_STATUS_STYLES, INV_STATUS_LABELS } from '../format'
import { recordPayment } from '../actions'
import { getInvoiceEditedSinceUnpost } from './actions'
import InvoiceCustomerPicker from './invoice-customer-picker'
import InvoiceEditPanel from './invoice-edit-panel'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    return renderPageError('invoices-detail', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600">Org not found</div>

  const invRow = await dbOrThrow(
    supabase
      .from('invoices')
      .select(
        'id, invoice_number, status, subtotal, tax_total, total, amount_paid, balance_due, due_date, notes, ' +
        'sales_order_id, customer_id, contact_id, is_posted, posted_at, title, install_address, ' +
        'billing_company_name, billing_street, billing_street2, billing_city, billing_state, billing_zip, ' +
        'shipping_name, shipping_street, shipping_street2, shipping_city, shipping_state, shipping_zip, ' +
        'created_at, customers(first_name, last_name, company_name, email)'
      )
      .eq('id', id)
      .eq('organization_id', org.id)
      .maybeSingle()
  )
  const inv = invRow as {
    id: string; invoice_number: number; status: string
    subtotal: number; tax_total: number; total: number; amount_paid: number; balance_due: number
    due_date: string | null; notes: string | null; sales_order_id: string | null
    customer_id: string | null; contact_id: string | null; is_posted: boolean; posted_at: string | null
    title: string | null; install_address: string | null
    billing_company_name: string | null; billing_street: string | null; billing_street2: string | null
    billing_city: string | null; billing_state: string | null; billing_zip: string | null
    shipping_name: string | null; shipping_street: string | null; shipping_street2: string | null
    shipping_city: string | null; shipping_state: string | null; shipping_zip: string | null
    created_at: string
    customers: { first_name: string; last_name: string; company_name: string | null; email: string | null } | null
  } | null
  if (!inv) return <div className="p-8 text-red-600">Invoice not found</div>

  const { allowed: canExportPdf } = await checkPermission(org.id, 'quotes.export_pdf')

  // Owner/admin role — matches assertInvoiceEditor's gate in actions.ts.
  const memberRow = await dbOrThrow(
    supabase
      .from('organization_members').select('role')
      .eq('organization_id', org.id)
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()
  ) as { role: string } | null
  const canEdit = ['owner', 'admin'].includes(memberRow?.role ?? '')

  // Contact (migration 132) — same shape as SO/quote/job's contact_id lookups.
  let contactName: string | null = null
  if (inv.contact_id) {
    const ccRow = await dbOrThrow(
      supabase.from('customer_contacts').select('full_name').eq('id', inv.contact_id).maybeSingle()
    ) as { full_name: string } | null
    contactName = ccRow?.full_name ?? null
  }

  const editedSinceUnpost = inv.is_posted ? false : await getInvoiceEditedSinceUnpost(inv.id)

  // SO reference
  let soNum: number | null = null
  if (inv.sales_order_id) {
    const so = await dbOrThrow(
      supabase.from('sales_orders').select('so_number').eq('id', inv.sales_order_id).maybeSingle()
    )
    soNum = (so as { so_number: number } | null)?.so_number ?? null
  }

  // Line items from the linked quote (via SO → quote)
  type LineItem = { description: string; quantity: number; unit_price: number; total_price: number }
  let lineItems: LineItem[] = []
  if (inv.sales_order_id) {
    const soRow = await dbOrThrow(
      supabase.from('sales_orders').select('quote_id').eq('id', inv.sales_order_id).maybeSingle()
    )
    const quoteId = (soRow as { quote_id: string | null } | null)?.quote_id
    if (quoteId) {
      const li = await dbOrThrow(
        supabase.from('quote_line_items').select('description, quantity, unit_price, total_price').eq('quote_id', quoteId).order('sort_order')
      )
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
            <InvoiceCustomerPicker
              invoiceId={inv.id}
              orgId={org.id}
              orgSlug={slug}
              initialCustomerId={inv.customer_id}
              initialCustomerName={inv.customers ? `${inv.customers.first_name} ${inv.customers.last_name}`.trim() : null}
              initialCompanyName={inv.customers?.company_name ?? null}
              initialContactId={inv.contact_id}
              initialContactName={contactName}
              canReassign={canEdit && !inv.is_posted}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${INV_STATUS_STYLES[inv.status] ?? 'bg-gray-100 text-gray-700'}`}>
              {INV_STATUS_LABELS[inv.status] ?? inv.status}
            </span>
            {canExportPdf && (
              <a
                href={`/api/invoices/${inv.id}/pdf`}
                download
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download PDF
              </a>
            )}
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

      {/* Unpost / Edit / Repost */}
      <div className="mt-6">
        <InvoiceEditPanel
          invoiceId={inv.id}
          orgId={org.id}
          orgSlug={slug}
          isPosted={inv.is_posted}
          canEdit={canEdit}
          editedSinceUnpost={editedSinceUnpost}
          initial={{
            title: inv.title,
            notes: inv.notes,
            install_address: inv.install_address,
            billing_company_name: inv.billing_company_name,
            billing_street: inv.billing_street,
            billing_street2: inv.billing_street2,
            billing_city: inv.billing_city,
            billing_state: inv.billing_state,
            billing_zip: inv.billing_zip,
            shipping_name: inv.shipping_name,
            shipping_street: inv.shipping_street,
            shipping_street2: inv.shipping_street2,
            shipping_city: inv.shipping_city,
            shipping_state: inv.shipping_state,
            shipping_zip: inv.shipping_zip,
          }}
        />
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
