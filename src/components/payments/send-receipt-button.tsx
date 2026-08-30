'use client'

import { useState } from 'react'
import { sendPaymentReceipt } from '@/app/actions/send-payment-receipt'

export default function SendReceiptButton({ paymentId, orgId }: { paymentId: string; orgId: string }) {
  const [isSending, setIsSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleClick() {
    setIsSending(true)
    setResult(null)
    const res = await sendPaymentReceipt(paymentId, orgId)
    setIsSending(false)
    setResult(res.error ? { ok: false, message: res.error } : { ok: true, message: 'Receipt sent.' })
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isSending}
        className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        {isSending ? 'Sending…' : 'Send Receipt'}
      </button>
      {result && (
        <p className={`mt-2 text-sm ${result.ok ? 'text-green-700' : 'text-red-600'}`}>{result.message}</p>
      )}
    </div>
  )
}
