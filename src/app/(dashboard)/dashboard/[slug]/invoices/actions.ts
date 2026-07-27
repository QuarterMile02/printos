'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type InvoiceSearchRow = {
  id: string
  invoice_number: number
  status: string
  total: number
  balance_due: number
  due_date: string | null
  created_at: string
  customer_id: string | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

// Search across customer name, invoice number, and total (in dollars, typed
// without a $ sign). fetchDataTablePage's generic ILIKE-across-searchColumns
// grammar can't express "convert typed dollars to cents and compare", so
// this runs as a standalone live query via useDataTableQuery's searchFn
// extension point instead — still a real server-side Supabase query, not
// client-side filtering, just a different (already-supported) hook path
// than the plain ILIKE one Quotes/Sales Orders use.
//
// PostgREST's or() logic-tree parser does NOT accept embedded-resource dot
// paths (e.g. "customers.first_name.ilike...") or column casts
// (e.g. "invoice_number::text.ilike...") as condition fragments — both were
// tried and empirically fail with "failed to parse logic tree" (confirmed
// against the live dev DB). So customer-name matching runs as a separate
// preliminary lookup against the customers table (flat ILIKE, no dot path)
// whose matching ids feed a plain customer_id.in.(...) condition, and
// invoice-number matching uses an exact integer equality instead of a cast
// substring search.
export async function searchInvoices(orgId: string, term: string): Promise<InvoiceSearchRow[]> {
  const cleaned = term.trim()
  if (cleaned.length < 2) return []

  const supabase = await createClient()

  // Strip commas (thousands separators) before checking whether the term is
  // a bare dollar amount, e.g. "1,234.56" -> "1234.56".
  const commaless = cleaned.replace(/,/g, '')
  const isDollarAmount = /^\d+(\.\d+)?$/.test(commaless)
  const totalCentsMatch = isDollarAmount ? Math.round(parseFloat(commaless) * 100) : null
  const isPlainInteger = /^\d+$/.test(commaless)
  const invoiceNumberMatch = isPlainInteger ? parseInt(commaless, 10) : null

  // Strip characters that would break PostgREST's or() filter syntax.
  const safeTerm = cleaned.replace(/[,()'"]/g, ' ').trim()

  const conditions: string[] = []
  if (totalCentsMatch !== null) {
    conditions.push(`total.eq.${totalCentsMatch}`)
  }
  if (invoiceNumberMatch !== null) {
    conditions.push(`invoice_number.eq.${invoiceNumberMatch}`)
  }
  if (safeTerm.length >= 2) {
    const { data: customerRows } = await supabase
      .from('customers')
      .select('id')
      .eq('organization_id', orgId)
      .or(`first_name.ilike.%${safeTerm}%,last_name.ilike.%${safeTerm}%,company_name.ilike.%${safeTerm}%`)
      .limit(50)
    const customerIds = (customerRows ?? []).map((r) => (r as { id: string }).id)
    if (customerIds.length > 0) {
      conditions.push(`customer_id.in.(${customerIds.join(',')})`)
    }
  }
  if (conditions.length === 0) return []

  const { data, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, status, total, balance_due, due_date, created_at, customer_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', orgId)
    .or(conditions.join(','))
    .order('invoice_number', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[searchInvoices]', error.message)
    return []
  }

  return (data ?? []) as InvoiceSearchRow[]
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
    .select('id, customer_id, total, quote_id')
    .eq('id', salesOrderId)
    .single()

  if (soError || !soRow) throw new Error('Sales order not found')
  const so = soRow as { id: string; customer_id: string | null; total: number | null; quote_id: string | null }

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
