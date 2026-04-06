'use client'

import { useState, useTransition, useCallback } from 'react'
import { updateCustomer } from '../actions'
import VoiceInput from '@/components/voice-input'

type CustomerData = {
  first_name: string
  last_name: string
  company_name: string | null
  email: string | null
  phone: string | null
  notes: string | null
}

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  initialData: CustomerData
}

export default function CustomerDetailClient({ customerId, orgId, orgSlug, initialData }: Props) {
  const [editing, setEditing] = useState(false)
  const [data, setData] = useState<CustomerData>(initialData)
  const [draft, setDraft] = useState<CustomerData>(initialData)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const handleVoiceTranscript = useCallback((text: string) => {
    setDraft((prev) => ({ ...prev, notes: (prev.notes ? prev.notes + ' ' : '') + text }))
  }, [])

  function startEdit() {
    setDraft({ ...data })
    setEditing(true)
    setError(null)
  }

  function cancelEdit() {
    setEditing(false)
    setError(null)
  }

  function saveEdit() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await updateCustomer(customerId, orgId, orgSlug, {
        first_name: draft.first_name,
        last_name: draft.last_name,
        company_name: draft.company_name,
        email: draft.email,
        phone: draft.phone,
        notes: draft.notes,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setData({ ...draft })
        setEditing(false)
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    })
  }

  const inputClass = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

  return (
    <div className="space-y-6">
      {/* Edit / View card */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Customer Details</h2>
          {!editing ? (
            <div className="flex items-center gap-2">
              {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
              <button
                onClick={startEdit}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-qm-black hover:bg-qm-surface transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
                </svg>
                Edit
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button onClick={cancelEdit} disabled={isPending} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={saveEdit} disabled={isPending} className="rounded-md bg-qm-lime px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
        )}

        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">First name <span className="text-red-500">*</span></label>
                <input type="text" value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Last name <span className="text-red-500">*</span></label>
                <input type="text" value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company</label>
              <input type="text" value={draft.company_name ?? ''} onChange={(e) => setDraft({ ...draft, company_name: e.target.value || null })} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value || null })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value || null })} className={inputClass} />
              </div>
            </div>
          </div>
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-qm-gray">Name</dt>
              <dd className="font-medium text-qm-black">{data.first_name} {data.last_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-qm-gray">Company</dt>
              <dd className="font-medium text-qm-black">{data.company_name || <span className="text-gray-300">—</span>}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-qm-gray">Email</dt>
              <dd className="font-medium text-qm-black">{data.email || <span className="text-gray-300">—</span>}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-qm-gray">Phone</dt>
              <dd className="font-medium text-qm-black">{data.phone || <span className="text-gray-300">—</span>}</dd>
            </div>
          </dl>
        )}
      </div>

      {/* Notes */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Notes</h2>
          {editing && <VoiceInput onTranscript={handleVoiceTranscript} />}
        </div>
        {editing ? (
          <textarea
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
            rows={4}
            maxLength={1000}
            placeholder="Any additional notes..."
            className={inputClass}
          />
        ) : (
          <p className="text-sm text-qm-black whitespace-pre-wrap">
            {data.notes || <span className="text-qm-gray">No notes</span>}
          </p>
        )}
      </div>
    </div>
  )
}
