'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type InvoiceSearchRow = {
  id: string
  invoice_number: number
  title: string | null
  status: string
  total: number
  balance_due: number
  due_date: string | null
  created_at: string
  customer_id: string | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

type InvoiceFuzzyRpcRow = {
  id: string
  invoice_number: number
  title: string | null
  status: string
  total: number
  balance_due: number
  due_date: string | null
  created_at: string
  customer_id: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  customer_company_name: string | null
}

// Trigram fuzzy search (migration 127's search_invoices_fuzzy) — replaces
// the previous two-round-trip TypeScript approach (a preliminary
// ILIKE-only customer lookup feeding a customer_id.in.(...) condition into
// the main invoices query), which existed only because PostgREST's or()
// logic-tree parser can't express a nested-column ILIKE or a numeric cast
// in one call (confirmed via "failed to parse logic tree" errors). A real
// SQL function can freely JOIN and reference joined columns, so this
// collapses to one round trip AND upgrades customer-name matching from
// exact-ILIKE-only to the same 3-strategy fuzziness as title.
//
// invoices.total is integer CENTS (same convention as quotes.total and
// sales_orders.total — this pattern was originally built from
// searchInvoices, which the other three copied), so the numeric
// exact-match semantics stay unchanged: dollar amount -> *100 -> `total =`
// equality, bare integer -> `invoice_number =` equality — computed inside
// the RPC now, same values, same rounding.
export async function searchInvoices(orgId: string, term: string): Promise<InvoiceSearchRow[]> {
  const cleaned = term.trim()
  if (cleaned.length < 2) return []

  const service = createServiceClient()
  const { data, error } = await service.rpc('search_invoices_fuzzy', {
    p_org_id: orgId,
    p_term: cleaned,
  }) as { data: InvoiceFuzzyRpcRow[] | null; error: { message: string } | null }

  if (error) {
    console.error('[searchInvoices]', error.message)
    return []
  }

  // Reshape the RPC's flat customer_* columns back into the nested
  // `customers` object InvoiceSearchRow (and every consumer of it)
  // expects — keeps invoices-list-client.tsx untouched.
  return (data ?? []).map((r) => ({
    id: r.id,
    invoice_number: r.invoice_number,
    title: r.title,
    status: r.status,
    total: r.total,
    balance_due: r.balance_due,
    due_date: r.due_date,
    created_at: r.created_at,
    customer_id: r.customer_id,
    customers: r.customer_id
      ? {
          first_name: r.customer_first_name ?? '',
          last_name: r.customer_last_name ?? '',
          company_name: r.customer_company_name,
        }
      : null,
  }))
}

export async function recordPayment(formData: FormData): Promise<void> {
  const invoiceId = formData.get('invoiceId') as string
  const orgSlug = formData.get('orgSlug') as string
  const amountDollars = parseFloat(formData.get('amount') as string)

  if (!invoiceId || !orgSlug || isNaN(amountDollars) || amountDollars <= 0) {
    throw new Error('Invalid payment data')
  }

  const amountCents = Math.round(amountDollars * 100)
  const supabase = await createClient()

  const { data: invoice, error: fetchError } = await supabase
    .from('invoices')
    .select('total, amount_paid, balance_due')
    .eq('id', invoiceId)
    .single() as any

  if (fetchError || !invoice) throw new Error('Invoice not found')

  const newAmountPaid = invoice.amount_paid + amountCents
  const newBalanceDue = Math.max(0, invoice.total - newAmountPaid)
  const newStatus = newBalanceDue <= 0 ? 'paid' : 'partial'

  const { error } = await (supabase as any)
    .from('invoices')
    .update({
      amount_paid: newAmountPaid,
      balance_due: newBalanceDue,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)

  if (error) throw new Error(error.message)

  revalidatePath(`/dashboard/${orgSlug}/invoices/${invoiceId}`)
  revalidatePath(`/dashboard/${orgSlug}/invoices`)
}

export async function createInvoiceFromSO(
  salesOrderId: string,
  orgSlug: string,
  dueDays = 30,
): Promise<string> {
  const service = createServiceClient()

  const { data: org } = await service
    .from('organizations')
    .select('id')
    .eq('slug', orgSlug)
    .single()

  if (!org) throw new Error('Organization not found')

  // Idempotency guard
  const { data: existing } = await service
    .from('invoices')
    .select('id')
    .eq('sales_order_id', salesOrderId)
    .maybeSingle()

  if (existing) throw new Error('Invoice already exists for this Sales Order')

  const { data: soRow, error: soError } = await service
    .from('sales_orders')
    .select('id, title, customer_id, total, quote_id')
    .eq('id', salesOrderId)
    .single()

  if (soError || !soRow) throw new Error('Sales order not found')
  const so = soRow as { id: string; title: string | null; customer_id: string | null; total: number | null; quote_id: string | null }

  // Prefer quote totals (include tax) over SO total
  let subtotal = so.total ?? 0
  let taxTotal = 0
  if (so.quote_id) {
    const { data: q } = await service
      .from('quotes')
      .select('subtotal, tax_total')
      .eq('id', so.quote_id)
      .maybeSingle()
    const quote = q as { subtotal: number | null; tax_total: number | null } | null
    if (quote) {
      subtotal = quote.subtotal ?? subtotal
      taxTotal = quote.tax_total ?? 0
    }
  }

  const total = subtotal + taxTotal
  const dueDate = new Date()
  dueDate.setDate(dueDate.getDate() + dueDays)

  const { data: invoice, error: createError } = await service
    .from('invoices')
    .insert({
      organization_id: org.id,
      sales_order_id: salesOrderId,
      title: so.title,
      customer_id: so.customer_id,
      status: 'draft',
      subtotal,
      tax_total: taxTotal,
      total,
      amount_paid: 0,
      balance_due: total,
      due_date: dueDate.toISOString().slice(0, 10),
    })
    .select('id')
    .single()

  if (createError) throw new Error(createError.message)
  if (!invoice) throw new Error('Failed to create invoice')

  revalidatePath(`/dashboard/${orgSlug}/invoices`)
  revalidatePath(`/dashboard/${orgSlug}/sales-orders`)

  return invoice.id
}
