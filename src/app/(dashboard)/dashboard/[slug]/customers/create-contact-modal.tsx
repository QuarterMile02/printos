'use client'

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { saveContact, type ContactInput } from './actions'
import PhoneInput from '@/components/ui/PhoneInput'

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  onSuccess?: (contactId?: string, contactName?: string) => void
  onClose: () => void
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

export default function CreateContactModal({ customerId, orgId, orgSlug, onSuccess, onClose }: Props) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [title, setTitle] = useState('')
  const [email, setEmail] = useState('')
  const [email2, setEmail2] = useState('')
  const [phone, setPhone] = useState('')
  const [phone2, setPhone2] = useState('')
  const [phoneExt, setPhoneExt] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [isAp, setIsAp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    setError(null)
    if (!firstName.trim()) { setError('First name is required.'); return }
    if (!lastName.trim()) { setError('Last name is required.'); return }
    const fullName = `${firstName.trim()} ${lastName.trim()}`
    const draft: ContactInput & { full_name: string } = {
      full_name: fullName,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim() || null,
      email2: email2.trim() || null,
      phone: phone.trim() || null,
      phone2: phone2.trim() || null,
      phone_ext: phoneExt.trim() || null,
      title: title.trim() || null,
      is_primary: isPrimary,
      is_ap_contact: isAp,
    }
    startTransition(async () => {
      const res = await saveContact(customerId, orgId, orgSlug, draft)
      if (res.error) { setError(res.error); return }
      onSuccess?.(res.id, fullName)
    })
  }

  const modal = (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8 px-4">
      <div className="absolute inset-0 bg-black/40" onClick={() => !isPending && onClose()} />
      <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Add Contact</h2>
            <p className="mt-0.5 text-sm text-gray-500">First and last name are required.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isPending} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">First Name <span className="text-red-500">*</span></label>
              <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className={ic} placeholder="Jane" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Last Name <span className="text-red-500">*</span></label>
              <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} className={ic} placeholder="Smith" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} className={ic} placeholder="Project Manager" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input type="text" value={email} onChange={e => setEmail(e.target.value)} className={ic} placeholder="jane@example.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email 2</label>
              <input type="text" value={email2} onChange={e => setEmail2(e.target.value)} className={ic} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
              <PhoneInput value={phone} onChange={(val) => setPhone(val.replace(/\D/g, '').length > 3 ? val : '')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Phone 2</label>
              <PhoneInput value={phone2} onChange={(val) => setPhone2(val.replace(/\D/g, '').length > 3 ? val : '')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Ext</label>
              <input type="text" value={phoneExt} onChange={e => setPhoneExt(e.target.value)} className={ic} maxLength={10} />
            </div>
            <div className="col-span-2 flex items-center gap-6 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={isPrimary} onChange={e => setIsPrimary(e.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                Primary contact
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input type="checkbox" checked={isAp} onChange={e => setIsAp(e.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                AP contact
              </label>
            </div>
          </div>
        </div>

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
