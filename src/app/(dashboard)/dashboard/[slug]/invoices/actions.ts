'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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
