'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPayment, type PaymentTargetType } from '@/app/actions/record-payment'
import { chargeCardPayment } from '@/app/actions/charge-card-payment'
import { tokenizeCard } from '@/lib/payments/accept-js-client'
import type { PublicGatewayConfig } from '@/lib/payments/gateway-config'
import SendReceiptConfirm from './send-receipt-confirm'

export type PaymentMethodOption = { id: string; name: string; type: string }

type Props = {
  orgId: string
  orgSlug: string
  customerId: string
  target: { type: PaymentTargetType; id: string }
  defaultAmountCents: number
  paymentMethods: PaymentMethodOption[]
  revalidatePath: string
  onRecorded?: (paymentId: string) => void
  // Absent/undefined on any page that hasn't been wired up yet -- treated
  // as "not configured," which is exactly right: no gateway config means
  // no card charge should be attempted.
  gatewayConfig?: PublicGatewayConfig
}

// Authorize.net's card_type CHECK constraint on payment_methods.type is
// looser than this ('Credit Card' is the one value every seed row uses
// for card-shaped methods -- AMEX and Credit Card both) -- this is the
// same gate ShopVOX uses: selecting a card-typed method expands the card
// fields inline and swaps the submit button to "Process Payment."
const CARD_TYPE = 'Credit Card'

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function RecordPaymentForm({
  orgId, orgSlug, customerId, target, defaultAmountCents, paymentMethods, revalidatePath, onRecorded, gatewayConfig,
}: Props) {
  const router = useRouter()
  const [amount, setAmount] = useState((defaultAmountCents / 100).toFixed(2))
  const [methodId, setMethodId] = useState(paymentMethods[0]?.id ?? '')
  const [checkNumber, setCheckNumber] = useState('')
  const [paidOn, setPaidOn] = useState(todayIso())
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set once recordPayment() succeeds -- swaps the form out for the
  // send-receipt confirmation step until the user sends or skips.
  const [recordedPaymentId, setRecordedPaymentId] = useState<string | null>(null)

  // Card fields -- these values are handed to Accept.js's dispatchData()
  // and NEVER included in the form's own submit payload to our server;
  // see handleCardSubmit below. Cleared immediately after tokenization
  // succeeds or fails, same as any other field reset on completion.
  const [cardNumber, setCardNumber] = useState('')
  const [cardMonth, setCardMonth] = useState('')
  const [cardYear, setCardYear] = useState('')
  const [cardCode, setCardCode] = useState('')

  const selectedMethod = paymentMethods.find((m) => m.id === methodId)
  const isCheck = selectedMethod?.type === 'Check'
  const isCard = selectedMethod?.type === CARD_TYPE

  async function handleCardSubmit(dollars: number) {
    if (!gatewayConfig?.configured || !gatewayConfig.apiLoginId || !gatewayConfig.clientKey) {
      setError('Payment gateway not configured for this organization. Set it up in Settings → Payment Gateway.')
      return
    }
    if (!cardNumber.trim() || !cardMonth.trim() || !cardYear.trim() || !cardCode.trim()) {
      setError('Enter the full card number, expiration, and security code.')
      return
    }

    setIsSaving(true)
    setError(null)

    // 1. Tokenize client-side -- the browser talks directly to
    // Authorize.net here; the card number/CVV never reach our server.
    const tokenized = await tokenizeCard(
      gatewayConfig.testMode,
      gatewayConfig.apiLoginId,
      gatewayConfig.clientKey,
      { cardNumber: cardNumber.replace(/\s+/g, ''), month: cardMonth.trim(), year: cardYear.trim(), cardCode: cardCode.trim() },
    )
    if ('error' in tokenized) {
      setIsSaving(false)
      setError(tokenized.error)
      return
    }

    // 2. Charge the nonce, then (only on success) record the payment --
    // see charge-card-payment.ts for the ordering guarantee.
    const res = await chargeCardPayment({
      orgId, orgSlug, customerId,
      amountPaidCents: Math.round(dollars * 100),
      paymentMethod: selectedMethod!.name,
      paidOn,
      note: note.trim() || null,
      target,
      revalidate: revalidatePath,
      opaqueData: tokenized.opaqueData,
    })
    setIsSaving(false)

    if (res.error) { setError(res.error); return }
    setCardNumber(''); setCardMonth(''); setCardYear(''); setCardCode('')
    if (res.paymentId) setRecordedPaymentId(res.paymentId)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const dollars = parseFloat(amount)
    if (isNaN(dollars) || dollars <= 0) { setError('Enter a valid amount.'); return }
    if (!selectedMethod) { setError('Select a payment method.'); return }
    if (isCheck && !checkNumber.trim()) { setError('Check number is required for check payments.'); return }

    if (isCard) { await handleCardSubmit(dollars); return }

    setIsSaving(true)
    const res = await recordPayment({
      orgId, orgSlug, customerId,
      amountPaidCents: Math.round(dollars * 100),
      paymentMethod: selectedMethod.name,
      checkNumber: isCheck ? checkNumber.trim() : null,
      paidOn,
      note: note.trim() || null,
      target,
      revalidate: revalidatePath,
    })
    setIsSaving(false)

    if (res.error) { setError(res.error); return }
    if (res.paymentId) setRecordedPaymentId(res.paymentId)
  }

  // Fires once the receipt confirmation step is dismissed (sent or
  // skipped) -- refresh so the page's own server-fetched numbers
  // (balance_due, status, etc.) catch up with what recordPayment just
  // changed, then let the caller close its modal / reset, if it has one.
  function handleReceiptStepDone() {
    const id = recordedPaymentId
    setRecordedPaymentId(null)
    setAmount((defaultAmountCents / 100).toFixed(2))
    setCheckNumber('')
    setNote('')
    router.refresh()
    if (id) onRecorded?.(id)
  }

  if (recordedPaymentId) {
    return <SendReceiptConfirm paymentId={recordedPaymentId} orgId={orgId} onDone={handleReceiptStepDone} />
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700">Payment Method</label>
          <select
            value={methodId}
            onChange={(e) => setMethodId(e.target.value)}
            required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            {paymentMethods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Paid On</label>
          <input
            type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">Amount Paid ($)</label>
        <input
          type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
      </div>

      {isCheck && (
        <div>
          <label className="block text-sm font-medium text-gray-700">Check Number</label>
          <input
            type="text" value={checkNumber} onChange={(e) => setCheckNumber(e.target.value)} required
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
      )}

      {isCard && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3">
          {!gatewayConfig?.configured && (
            <p className="text-xs text-amber-700">
              Payment gateway not configured for this organization. Set it up in Settings → Payment Gateway.
            </p>
          )}
          {gatewayConfig?.testMode && (
            <p className="text-xs text-amber-700">Test mode is active — this will not charge a real card.</p>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700">Card Number</label>
            <input
              type="text" inputMode="numeric" autoComplete="cc-number" placeholder="4111 1111 1111 1111"
              value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} required={isCard}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Month</label>
              <input
                type="text" inputMode="numeric" autoComplete="cc-exp-month" placeholder="MM" maxLength={2}
                value={cardMonth} onChange={(e) => setCardMonth(e.target.value)} required={isCard}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Year</label>
              <input
                type="text" inputMode="numeric" autoComplete="cc-exp-year" placeholder="YYYY" maxLength={4}
                value={cardYear} onChange={(e) => setCardYear(e.target.value)} required={isCard}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">CVV</label>
              <input
                type="text" inputMode="numeric" autoComplete="cc-csc" placeholder="123" maxLength={4}
                value={cardCode} onChange={(e) => setCardCode(e.target.value)} required={isCard}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700">Note</label>
        <input
          type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
      </div>

      <button
        type="submit" disabled={isSaving}
        className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        {isSaving ? (isCard ? 'Processing…' : 'Recording…') : (isCard ? 'Process Payment' : 'Record Payment')}
      </button>
    </form>
  )
}
