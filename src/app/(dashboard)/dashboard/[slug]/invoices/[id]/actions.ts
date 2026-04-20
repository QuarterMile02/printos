'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { logActivity } from '@/lib/logActivity'

export async function recordPayment(formData: FormData) {
  const invoiceId = formData.get('invoiceId') as string
  const orgSlug = formData.get('orgSlug') as string
  const amountStr = formData.get('amount') as string
  const amountCents = Math.round(parseFloat(amountStr) * 100)

  if (!amountCents || amountCents <= 0) throw new Error('Invalid payment amount')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const service = createServiceClient()

  const { data: inv } = await service.from('invoices').select('total, amount_paid, organization_id, status').eq('id', invoiceId).single()
  const invoice = inv as { total: number; amount_paid: number; organization_id: string; status: string } | null
  if (!invoice) throw new Error('Invoice not found')

  const newPaid = invoice.amount_paid + amountCents
  const newBalance = invoice.total - newPaid
  const newStatus = newBalance <= 0 ? 'paid' : 'partial'

  await service.from('invoices').update({
    amount_paid: newPaid,
    balance_due: Math.max(0, newBalance),
    status: newStatus,
    updated_at: new Date().toISOString(),
  }).eq('id', invoiceId)

  if (user && newStatus === 'paid' && invoice.status !== 'paid') {
    await logActivity({
      org_id: invoice.organization_id,
      user_id: user.id,
      entity_type: 'invoice',
      entity_id: invoiceId,
      action: 'marked_paid',
      from_value: invoice.status,
      to_value: 'paid',
      metadata: { amount_paid_cents: newPaid, total_cents: invoice.total },
    })
  }

  redirect(`/dashboard/${orgSlug}/invoices/${invoiceId}`)
}
