'use server'

// Card-payment entry point. Does NOT create a second write path -- the
// only thing this adds on top of recordPayment() (record-payment.ts) is
// the Authorize.net charge itself; the actual payments/payment_applications
// write is 100% delegated to recordPayment(), same RPC, same trigger-driven
// invoice totals, same everything check/cash payments already use.
//
// Ordering is the entire point of this file existing as a separate step
// instead of folding the charge into recordPayment() directly: charge
// FIRST, and only call recordPayment() if that charge actually succeeded.
// A declined or errored charge returns immediately -- recordPayment() is
// never reached, so no payments row is ever written for a card that
// didn't clear.

import { checkPermission } from '@/lib/check-permission'
import { chargeCard, type OpaqueData } from '@/lib/payments/authorize-net'
import { recordPayment, type PaymentTargetType } from './record-payment'

export type ChargeCardPaymentInput = {
  orgId: string
  orgSlug: string
  customerId: string
  amountPaidCents: number
  paymentMethod: string // the payment_methods.name selected (e.g. "Credit Card", "AMEX")
  paidOn: string
  note?: string | null
  target: { type: PaymentTargetType; id: string }
  revalidate: string
  opaqueData: OpaqueData
  invoiceNumber?: string
}

export async function chargeCardPayment(
  input: ChargeCardPaymentInput,
): Promise<{ error?: string; paymentId?: string }> {
  // Same permission gate recordPayment() enforces -- checked here too so
  // an unauthorized caller never reaches Authorize.net at all, not just
  // never reaches the DB write.
  const { allowed } = await checkPermission(input.orgId, 'invoices.record_payment')
  if (!allowed) return { error: 'You do not have permission to record payments.' }

  if (!Number.isFinite(input.amountPaidCents) || input.amountPaidCents <= 0) {
    return { error: 'Enter a valid payment amount.' }
  }

  // NOT BUILT (explicitly out of scope this pass): the 3% Administrative
  // Fee / card surcharge. accounting_settings already has
  // program_fee_credit_card (migration 081) as a percentage, unused so
  // far. When that's built, input.amountPaidCents here is the ONE hook
  // point that matters -- it's what actually gets sent to Authorize.net
  // AND what gets recorded via recordPayment() below, so a surcharge
  // needs to be added to it (or passed as a separate explicit
  // surchargeCents param) BEFORE this call, not somewhere in the UI only
  // -- otherwise the charged amount and the recorded amount would agree
  // with each other but not match what the customer's card was actually
  // billed for beyond the invoice total. Setup/Shipping/Finance charge
  // lines are a separate, earlier concern (they'd change what
  // amountPaidCents / defaultAmountCents even is, upstream of this file
  // entirely -- probably at the invoice/quote total level) and aren't
  // specific to the card path at all.

  // 1. Tokenize already happened client-side (Accept.js) before this was
  //    called -- input.opaqueData is that nonce, not a card number. Charge it.
  const charge = await chargeCard({
    orgId: input.orgId,
    amountCents: input.amountPaidCents,
    opaqueData: input.opaqueData,
    invoiceNumber: input.invoiceNumber,
    customerId: input.customerId,
  })

  if ('error' in charge) {
    // 2a. Charge failed/declined -- stop here. recordPayment() is never
    // called, so no payments row is written for a card that didn't clear.
    return { error: charge.error }
  }

  // 2b. Charge succeeded -- now, and only now, write the payment through
  // the same single write path every other method uses.
  return recordPayment({
    orgId: input.orgId,
    orgSlug: input.orgSlug,
    customerId: input.customerId,
    amountPaidCents: input.amountPaidCents,
    paymentMethod: input.paymentMethod,
    checkNumber: null,
    paidOn: input.paidOn,
    note: input.note ?? null,
    target: input.target,
    revalidate: input.revalidate,
    gatewayTransactionId: charge.transactionId,
    cardLast4: charge.cardLast4,
    cardBrand: charge.cardBrand,
  })
}
