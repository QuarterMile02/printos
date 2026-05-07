'use client'

import { useState } from 'react'

type Props = {
  quoteId: string
  organizationId: string
}

export default function QuoteApproveButton({ quoteId, organizationId }: Props) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function handle() {
    setBusy(true); setErrorMsg(null)
    try {
      const r = await fetch('/api/quotes/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quoteId, organization_id: organizationId }),
      })
      const json = await r.json()
      if (!r.ok || json.error) {
        setErrorMsg(json.error ?? 'Approve failed')
      } else {
        setDone(true)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">✓ Approved</span>
  }
  return (
    <>
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
      >
        {busy ? '…' : 'Approve'}
      </button>
      {errorMsg && <span className="text-xs text-red-600 ml-1">{errorMsg}</span>}
    </>
  )
}
