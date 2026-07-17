'use client'

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { saveContact, type ContactInput } from './actions'

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  onSuccess?: (contactId?: string, contactName?: string) => void
  onClose: () => void
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function emptyDraft(): ContactInput & { full_name: string } {
  return {
    full_name: '', first_name: null, last_name: null,
    email: null, email2: null, phone: null, phone2: null, phone_ext: null,
    title: null, is_primary: false, is_ap_contact: false,
  }
}

export default function CreateContactModal({ customerId, orgId, orgSlug, onSuccess, onClose }: Props) {
  const [draft, setDraft] = useState<ContactInput & { full_name: string }>(emptyDraft())
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    setError(null)
    if (!draft.full_name.trim()) { setError('Full name is required.'); return }
    startTransition(async () => {
      const res = await saveContact(customerId, orgId, orgSlug, draft)
      if (res.error) { setError(res.error); return }
      onSuccess?.(res.id, draft.full_name.trim())
    })
  }

  const modal = (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8 px-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !isPending && onClose()} />
      <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Add Contact</h2>
            <p className="mt-0.5 text-sm text-gray-500">Full name is required.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isPending} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">Full Name <span className="text-red-500">*</span></label>
              <input type="text" value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} className={ic} placeholder="Jane Smith" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">First Name</label>
              <input type="text" value={draft.first_name ?? ''} onChange={(e) => setDraft({ ...draft, first_name: e.target.value || null })} className={ic} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Last Name</label>
              <input type="text" value={draft.last_name ?? ''} onChange={(e) => setDraft({ ...draft, last_name: e.target.value || null })} className={ic} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
              <input type="text" value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value || null })} className={ic} placeholder="Project Manager" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="text" value={draft.email ?? ''} onChange={(e) => setDraft({ ...draft, email: e.target.value || null })} className={ic} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email 2</label>
              <input type="text" value={draft.email2 ?? ''} onChange={(e) => setDraft({ ...draft, email2: e.target.value || null })} className={ic} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <input type="text" value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value || null })} className={ic} placeholder="9561234567" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone 2</label>
              <input type="text" value={draft.phone2 ?? ''} onChange={(e) => setDraft({ ...draft, phone2: e.target.value || null })} className={ic} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ext</label>
              <input type="text" value={draft.phone_ext ?? ''} onChange={(e) => setDraft({ ...draft, phone_ext: e.target.value || null })} className={ic} maxLength={10} />
            </div>
            <div className="col-span-3 flex items-center gap-6 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={draft.is_primary ?? false} onChange={(e) => setDraft({ ...draft, is_primary: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                Primary contact
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={draft.is_ap_contact ?? false} onChange={(e) => setDraft({ ...draft, is_ap_contact: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                AP contact
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={isPending} className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
            {isPending ? 'Saving…' : 'Add Contact'}
          </button>
        </div>
      </div>
    </div>
  )

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : null
}
