'use client'

// Shown once by RecordPaymentForm right after recordPayment() succeeds --
// the confirmation step that surfaces "Send Receipt" where a payment is
// actually recorded, instead of only on /payments/[id] where nobody
// lands right after recording one. Recipient defaults to the same
// primary-contact-then-customer-email lookup sendPaymentReceipt uses
// internally (getDefaultReceiptRecipient), but stays editable, and the
// step can be skipped entirely.

import { useEffect, useState } from 'react'
import { getDefaultReceiptRecipient, sendPaymentReceipt } from '@/app/actions/send-payment-receipt'

type Props = {
  paymentId: string
  orgId: string
  onDone: () => void
}

export default function SendReceiptConfirm({ paymentId, orgId, onDone }: Props) {
  const [email, setEmail] = useState('')
  const [loadingDefault, setLoadingDefault] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    let cancelled = false
    getDefaultReceiptRecipient(paymentId, orgId).then((res) => {
      if (cancelled) return
      setEmail(res.email ?? '')
      setLoadingDefault(false)
    })
    return () => { cancelled = true }
  }, [paymentId, orgId])

  async function handleSend() {
    if (!email.trim()) { setError('Enter a recipient email.'); return }
    setError(null)
    setIsSending(true)
    const res = await sendPaymentReceipt(paymentId, orgId, email.trim())
    setIsSending(false)
    if (res.error) { setError(res.error); return }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800 flex items-center justify-between gap-3">
        <span>Receipt sent to {email}.</span>
        <button type="button" onClick={onDone} className="shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold text-green-800 hover:bg-green-100">
          Done
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <p className="text-sm font-medium text-gray-900">Payment recorded. Send a receipt?</p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3">
        <label className="block text-sm font-medium text-gray-700">Recipient</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loadingDefault}
          placeholder={loadingDefault ? 'Loading default recipient…' : 'recipient@example.com'}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime disabled:bg-gray-100"
        />
        {!loadingDefault && !email && (
          <p className="mt-1 text-xs text-amber-600">No email on file for this customer — enter one to send, or skip.</p>
        )}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleSend}
          disabled={isSending || loadingDefault}
          className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
        >
          {isSending ? 'Sending…' : 'Send Receipt'}
        </button>
      </div>
    </div>
  )
}
