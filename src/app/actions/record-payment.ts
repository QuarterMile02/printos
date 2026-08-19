'use server'

// The single write path for recording a payment, replacing the two
// disconnected ones this redesign exists to kill:
//   - invoices/actions.ts's old recordPayment, which wrote directly to
//     invoices.amount_paid/balance_due/status and never touched the
//     payments table at all.
//   - CustomerTabsSection.tsx's logPayment -> POST /api/payments, which
//     wrote a payments row but never sent invoice_id and never touched
//     the invoice.
//
// This calls record_payment() (migration 165), a single plpgsql
// function that inserts the payment + its application(s) in one
// transaction. It deliberately never writes to invoices/quotes/
// sales_orders itself -- trigger 161 (fired by the payment_applications
// insert inside the RPC) owns invoices.amount_paid/balance_due/status.
// If this file ever grows a second write to those columns, that's the
// exact bug this whole redesign was built to prevent -- don't add one.

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { checkPermission } from '@/lib/check-permission'
import { logActivity } from '@/lib/logActivity'
import { resolveOrderThreadIdFromSalesOrder } from '@/lib/order-thread-id'

export type PaymentTargetType = 'quote' | 'sales_order' | 'invoice'

export type RecordPaymentInput = {
  orgId: string
  orgSlug: string
  customerId: string
  amountPaidCents: number
  paymentMethod: string
  checkNumber?: string | null
  paidOn: string // 'YYYY-MM-DD'
  note?: string | null
  target: { type: PaymentTargetType; id: string }
  // Path to revalidate after recording -- the calling page knows its
  // own URL better than this shared action does.
  revalidate: string
  // Card payments only -- set by chargeCardPayment() (src/app/actions/
  // charge-card-payment.ts) AFTER Authorize.net has already approved the
  // charge, never before. This function has no way to verify that on its
  // own; it just records whatever it's given, which is why the ordering
  // guarantee lives entirely in the caller.
  gatewayTransactionId?: string | null
  cardLast4?: string | null
  cardBrand?: string | null
}

export async function recordPayment(
  input: RecordPaymentInput,
): Promise<{ error?: string; paymentId?: string }> {
  const { allowed } = await checkPermission(input.orgId, 'invoices.record_payment')
  if (!allowed) return { error: 'You do not have permission to record payments.' }

  if (!Number.isFinite(input.amountPaidCents) || input.amountPaidCents <= 0) {
    return { error: 'Enter a valid payment amount.' }
  }
  if (!input.paymentMethod.trim()) {
    return { error: 'Select a payment method.' }
  }
  if (!input.paidOn) {
    return { error: 'Select the date paid.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const service = createServiceClient()
  const { data: paymentId, error } = await service.rpc('record_payment', {
    p_organization_id: input.orgId,
    p_customer_id: input.customerId,
    p_amount_paid: input.amountPaidCents,
    p_payment_method: input.paymentMethod,
    p_paid_on: input.paidOn,
    p_note: input.note ?? null,
    p_check_number: input.checkNumber ?? null,
    p_created_by: user.id,
    p_applications: [
      { target_type: input.target.type, target_id: input.target.id, amount_applied: input.amountPaidCents },
    ],
    p_gateway_transaction_id: input.gatewayTransactionId ?? null,
    p_card_last4: input.cardLast4 ?? null,
    p_card_brand: input.cardBrand ?? null,
  }) as { data: string | null; error: { message: string } | null }

  if (error) return { error: error.message }

  // logActivity, preserved from the old recordPayment (invoices/actions.ts,
  // now removed) -- this is a separate audit-trail write, not a second
  // write to invoices.amount_paid/balance_due/status, so it doesn't
  // reintroduce the two-writers problem. Trigger 161 has already updated
  // the invoice by the time the RPC call above returns (one transaction),
  // so this read-after-write sees the final status.
  if (input.target.type === 'invoice') {
    const { data: inv } = await service
      .from('invoices')
      .select('status, total, amount_paid, sales_order_id')
      .eq('id', input.target.id)
      .maybeSingle() as {
        data: { status: string; total: number; amount_paid: number; sales_order_id: string | null } | null
      }
    if (inv?.status === 'paid') {
      const orderThreadId = await resolveOrderThreadIdFromSalesOrder(service, inv.sales_order_id)
      await logActivity({
        org_id: input.orgId,
        user_id: user.id,
        entity_type: 'invoice',
        entity_id: input.target.id,
        action: 'marked_paid',
        to_value: 'paid',
        metadata: { amount_paid_cents: inv.amount_paid, total_cents: inv.total },
        order_thread_id: orderThreadId ?? undefined,
      })
    }
  }

  revalidatePath(input.revalidate)
  return { paymentId: paymentId ?? undefined }
}
