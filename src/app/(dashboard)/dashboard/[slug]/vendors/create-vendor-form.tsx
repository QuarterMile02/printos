'use client'

import { useState, useRef, useTransition } from 'react'
import { createVendor } from './actions'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import PhoneInput from '@/components/ui/PhoneInput'

type Props = {
  orgId: string
  orgSlug: string
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function Lbl({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {children}{required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  )
}

function SectionHead({ title }: { title: string }) {
  return <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 pb-1.5 mb-3">{title}</p>
}

// Trigger button + modal extracted from vendors-list-client.tsx so page.tsx
// can render it in the header actions row, matching Customers' structure
// (create-customer-form.tsx is rendered from customers/page.tsx, not from
// customers-list-client.tsx). Trigger button styling matches Customers'
// "Add Customer" button exactly (qm-lime, plus icon) — previously this was
// styled qm-fuchsia, which only Customers' *modal submit* button uses, not
// its page-level trigger.
//
// Expanded to capture all 25 real vendor fields upfront (previously only
// 6 — name/primary_contact/primary_email/primary_phone/website/
// background_info — were settable at creation; the other 19, including
// both addresses, were edit-only). This directly unblocks Forms
// Visibility Settings' "Required" toggle for those 19 fields, which
// previously had no create-time UI to enforce against. Field set, order,
// and validation mirror vendor-detail-client.tsx's edit page exactly —
// same fields, same optional/required split (only Company Name is
// required, matching the edit page and the DB's own NOT NULL constraint).
export default function CreateVendorForm({ orgId, orgSlug }: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  // Controlled: phone (PhoneInput) + both addresses (AddressAutocomplete)
  const [vendorPhone, setVendorPhone] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [country, setCountry] = useState('US')
  const [secStreet, setSecStreet] = useState('')
  const [secCity, setSecCity] = useState('')
  const [secState, setSecState] = useState('')
  const [secZip, setSecZip] = useState('')

  function resetAll() {
    formRef.current?.reset()
    setVendorPhone('')
    setStreet(''); setCity(''); setState(''); setZip(''); setCountry('US')
    setSecStreet(''); setSecCity(''); setSecState(''); setSecZip('')
  }

  function handleCreate(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const res = await createVendor(orgId, orgSlug, formData)
      if (res.error) { setError(res.error); return }
      resetAll()
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
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8 px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { if (!pending) { setOpen(false); resetAll() } }} />

          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add Vendor</h2>
                <p className="mt-0.5 text-sm text-gray-500">Company name is required.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form ref={formRef} action={handleCreate}>
              <div className="px-6 py-5 space-y-6 max-h-[70vh] overflow-y-auto">
                {error && (
                  <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
                )}

                {/* ── VENDOR DETAILS ── */}
                <div className="space-y-3">
                  <SectionHead title="Vendor Details" />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl required>Company Name</Lbl>
                      <input name="name" type="text" required autoFocus maxLength={200} className={ic} />
                    </div>
                    <div>
                      <Lbl>Legal Name</Lbl>
                      <input name="legal_name" type="text" maxLength={200} className={ic} />
                    </div>
                  </div>
                  <div>
                    <Lbl>Primary Contact</Lbl>
                    <input name="primary_contact" type="text" maxLength={120} className={ic} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl>Email</Lbl>
                      <input name="primary_email" type="email" maxLength={200} className={ic} />
                    </div>
                    <div>
                      <Lbl>Phone</Lbl>
                      <PhoneInput
                        name="primary_phone"
                        value={vendorPhone}
                        onChange={(val) => setVendorPhone(val.replace(/\D/g, '').length > 3 ? val : '')}
                      />
                    </div>
                  </div>
                  <div>
                    <Lbl>Website</Lbl>
                    <input name="website" type="url" maxLength={200} placeholder="https://…" className={ic} />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <input type="checkbox" id="is_active" name="is_active" value="true" defaultChecked className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                    <label htmlFor="is_active" className="text-sm text-gray-700 cursor-pointer">Active vendor</label>
                  </div>
                </div>

                {/* ── PRIMARY ADDRESS ── */}
                <div className="space-y-3">
                  <SectionHead title="Primary Address" />
                  <div>
                    <Lbl>Street</Lbl>
                    <AddressAutocomplete
                      name="street_autocomplete"
                      defaultValue={street}
                      className={ic}
                      onSelect={(addr) => {
                        setStreet(addr.street)
                        setCity(addr.city)
                        setState(addr.state)
                        setZip(addr.zip)
                        setCountry(addr.country)
                      }}
                    />
                    <input type="hidden" name="street" value={street} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-1">
                      <Lbl>City</Lbl>
                      <input name="city" type="text" value={city} onChange={(e) => setCity(e.target.value)} className={ic} />
                    </div>
                    <div>
                      <Lbl>State</Lbl>
                      <input name="state" type="text" maxLength={2} value={state} onChange={(e) => setState(e.target.value)} placeholder="TX" className={ic} />
                    </div>
                    <div>
                      <Lbl>Zip</Lbl>
                      <input name="zip" type="text" value={zip} onChange={(e) => setZip(e.target.value)} className={ic} />
                    </div>
                  </div>
                  <div>
                    <Lbl>Country</Lbl>
                    <input name="country" type="text" maxLength={2} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" className={ic} />
                  </div>
                </div>

                {/* ── SECONDARY ADDRESS ── */}
                <div className="space-y-3">
                  <SectionHead title="Secondary Address" />
                  <div>
                    <Lbl>Street</Lbl>
                    <AddressAutocomplete
                      name="secondary_street_autocomplete"
                      defaultValue={secStreet}
                      className={ic}
                      onSelect={(addr) => {
                        setSecStreet(addr.street)
                        setSecCity(addr.city)
                        setSecState(addr.state)
                        setSecZip(addr.zip)
                      }}
                    />
                    <input type="hidden" name="secondary_street" value={secStreet} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-1">
                      <Lbl>City</Lbl>
                      <input name="secondary_city" type="text" value={secCity} onChange={(e) => setSecCity(e.target.value)} className={ic} />
                    </div>
                    <div>
                      <Lbl>State</Lbl>
                      <input name="secondary_state" type="text" maxLength={2} value={secState} onChange={(e) => setSecState(e.target.value)} placeholder="TX" className={ic} />
                    </div>
                    <div>
                      <Lbl>Zip</Lbl>
                      <input name="secondary_zip" type="text" value={secZip} onChange={(e) => setSecZip(e.target.value)} className={ic} />
                    </div>
                  </div>
                </div>

                {/* ── BUSINESS INFO ── */}
                <div className="space-y-3">
                  <SectionHead title="Business Info" />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl>Account Number</Lbl>
                      <input name="account_id" type="text" maxLength={100} className={ic} />
                    </div>
                    <div>
                      <Lbl>Payment Terms</Lbl>
                      <input name="terms" type="text" maxLength={100} placeholder="Net 30" className={ic} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl>Tax ID / EIN</Lbl>
                      <input name="tax_id" type="text" maxLength={50} className={ic} />
                    </div>
                    <div>
                      <Lbl>Tax</Lbl>
                      <input name="tax" type="text" maxLength={50} className={ic} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl>Payment Method</Lbl>
                      <input name="payment_method" type="text" maxLength={100} className={ic} />
                    </div>
                    <div>
                      <Lbl>Catalog URL</Lbl>
                      <input name="catalog_url" type="url" maxLength={200} placeholder="https://…" className={ic} />
                    </div>
                  </div>
                  <div>
                    <Lbl>Categories</Lbl>
                    <input name="categories" type="text" maxLength={200} placeholder="e.g. Vinyl, Paper, Hardware" className={ic} />
                  </div>
                  <div>
                    <Lbl>Hours of Operation</Lbl>
                    <input name="hours_of_operation" type="text" maxLength={200} placeholder="Mon–Fri 9am–5pm" className={ic} />
                  </div>
                  <div>
                    <Lbl>Notes / Background Info</Lbl>
                    <textarea name="notes" rows={2} maxLength={1000} className={ic} />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
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
