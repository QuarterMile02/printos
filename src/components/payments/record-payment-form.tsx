'use client'

import { useState } from 'react'
import { recordPayment, type PaymentTargetType } from '@/app/actions/record-payment'

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
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function RecordPaymentForm({
  orgId, orgSlug, customerId, target, defaultAmountCents, paymentMethods, revalidatePath, onRecorded,
}: Props) {
  const [amount, setAmount] = useState((defaultAmountCents / 100).toFixed(2))
  const [methodId, setMethodId] = useState(paymentMethods[0]?.id ?? '')
  const [checkNumber, setCheckNumber] = useState('')
  const [paidOn, setPaidOn] = useState(todayIso())
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedMethod = paymentMethods.find((m) => m.id === methodId)
  const isCheck = selectedMethod?.type === 'Check'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const dollars = parseFloat(amount)
    if (isNaN(dollars) || dollars <= 0) { setError('Enter a valid amount.'); return }
    if (!selectedMethod) { setError('Select a payment method.'); return }
    if (isCheck && !checkNumber.trim()) { setError('Check number is required for check payments.'); return }

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
    if (res.paymentId) onRecorded?.(res.paymentId)
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
        {isSaving ? 'Recording…' : 'Record Payment'}
      </button>
    </form>
  )
}
