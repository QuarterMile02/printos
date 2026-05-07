'use client'

import { useState } from 'react'
import VoiceInput from '@/components/voice-input'

const OUTCOMES = [
  'Left voicemail',
  'Spoke with customer',
  'Payment promised by date',
  'Payment disputed',
  'Unable to reach',
  'Sent written notice',
] as const

type Props = {
  customerId: string
  organizationId: string
  customerName: string
}

export default function CollectionCallForm({ customerId, organizationId, customerName }: Props) {
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<string>('')
  const [promiseDate, setPromiseDate] = useState<string>('')
  const [notes, setNotes] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [logged, setLogged] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const promiseRequired = outcome === 'Payment promised by date'

  async function handleSave() {
    if (!outcome) { setErrorMsg('Pick an outcome'); return }
    if (promiseRequired && !promiseDate) { setErrorMsg('Promise date required for that outcome'); return }
    setSaving(true); setErrorMsg(null)
    try {
      const r = await fetch('/api/collection-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: organizationId,
          customer_id: customerId,
          outcome,
          promise_date: promiseRequired ? promiseDate : null,
          notes: notes.trim() || null,
        }),
      })
      const json = await r.json()
      if (!r.ok || json.error) {
        setErrorMsg(json.error ?? 'Save failed')
      } else {
        setLogged(true); setOpen(false)
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (logged) {
    return <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">✓ Logged</span>
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-md border border-[#ee2b7b] px-2.5 py-1 text-xs font-semibold text-[#ee2b7b] hover:bg-[#ee2b7b]/10"
      >
        {open ? 'Cancel' : 'Log Call'}
      </button>
      {open && (
        <div className="mt-2 w-full rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2 text-xs">
          <div className="font-semibold text-[#1A1A1A]">Log call to {customerName}</div>
          <select
            value={outcome}
            onChange={(e) => { setOutcome(e.target.value); setErrorMsg(null) }}
            className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-[#93ca3b] focus:outline-none focus:ring-1 focus:ring-[#93ca3b]"
          >
            <option value="">— Outcome —</option>
            {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {promiseRequired && (
            <input
              type="date"
              value={promiseDate}
              onChange={(e) => { setPromiseDate(e.target.value); setErrorMsg(null) }}
              className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-[#93ca3b] focus:outline-none focus:ring-1 focus:ring-[#93ca3b]"
            />
          )}
          <div className="flex gap-2 items-start">
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes…"
              className="flex-1 block rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-[#93ca3b] focus:outline-none focus:ring-1 focus:ring-[#93ca3b]"
            />
            <VoiceInput onTranscript={(t) => setNotes((prev) => (prev ? `${prev} ${t}` : t))} />
          </div>
          {errorMsg && <div className="text-xs text-red-600">{errorMsg}</div>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-[#ee2b7b] px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Call Log'}
          </button>
        </div>
      )}
    </>
  )
}
