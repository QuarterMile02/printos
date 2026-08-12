'use client'

import { useState, useRef, useTransition } from 'react'
import { createVendor } from './actions'
import PhoneInput from '@/components/ui/PhoneInput'

type Props = {
  orgId: string
  orgSlug: string
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

// Trigger button + modal extracted from vendors-list-client.tsx so page.tsx
// can render it in the header actions row, matching Customers' structure
// (create-customer-form.tsx is rendered from customers/page.tsx, not from
// customers-list-client.tsx). Trigger button styling matches Customers'
// "Add Customer" button exactly (qm-lime, plus icon) — previously this was
// styled qm-fuchsia, which only Customers' *modal submit* button uses, not
// its page-level trigger.
export default function CreateVendorForm({ orgId, orgSlug }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [vendorPhone, setVendorPhone] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  function handleCreate(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await createVendor(orgId, orgSlug, formData)
      if (res.error) { setError(res.error); return }
      formRef.current?.reset()
      setVendorPhone('')
      setOpen(false)
      window.location.reload()
    })
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(null) }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-2"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        Add Vendor
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { if (!pending) { setOpen(false); setVendorPhone('') } }} />
          <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Add Vendor</h2>
            {error && (
              <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
            )}
            <form ref={formRef} action={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name <span className="text-red-500">*</span></label>
                <input name="name" type="text" required autoFocus maxLength={200} className={ic} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Primary Contact</label>
                  <input name="primary_contact" type="text" maxLength={120} className={ic} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <PhoneInput
                    name="primary_phone"
                    value={vendorPhone}
                    onChange={(val) => setVendorPhone(val.replace(/\D/g, '').length > 3 ? val : '')}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input name="primary_email" type="email" maxLength={200} className={ic} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <input name="website" type="url" maxLength={200} placeholder="https://…" className={ic} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea name="notes" rows={2} maxLength={1000} className={ic} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)} disabled={pending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={pending} className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                  {pending ? 'Saving…' : 'Add Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
