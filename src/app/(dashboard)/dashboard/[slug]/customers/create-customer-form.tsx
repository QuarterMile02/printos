'use client'

import { useState, useRef, useTransition, useCallback } from 'react'
import { createCustomer } from './actions'
import VoiceInput from '@/components/voice-input'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import PhoneInput from '@/components/ui/PhoneInput'

type SalesRep = { id: string; full_name: string | null }

type Props = {
  orgId: string
  orgSlug: string
  salesReps: SalesRep[]
  initialOpen?: boolean
  onSuccess?: () => void
}

const INDUSTRY_OPTIONS = [
  'Advertising / Marketing', 'Automotive', 'Construction & Trades', 'Education',
  'Entertainment / Events', 'Food & Beverage', 'Government', 'Healthcare',
  'Hospitality / Tourism', 'Legal / Professional Services', 'Manufacturing',
  'Non-profit', 'Real Estate', 'Retail', 'Sports & Recreation',
  'Technology', 'Transportation / Logistics', 'Other',
]
const STATUS_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'closable', label: 'Closable' },
  { value: 'sold', label: 'Sold' },
]
const LEAD_SOURCES = ['Referral', 'Walk-in', 'Google', 'Social Media', 'Trade Show', 'Cold Call', 'Website', 'Other']
const PAYMENT_TERMS_OPTIONS = ['60/40', 'Net 30', 'Net 45', 'Due on Receipt', 'CC']

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const sc = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime bg-white'

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

export default function CreateCustomerForm({ orgId, orgSlug, salesReps, initialOpen = false, onSuccess }: Props) {
  const [open, setOpen] = useState(initialOpen)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  // Controlled fields
  const [mobilPhone, setMobilePhone] = useState('')
  const [workPhone, setWorkPhone] = useState('')
  const [showOtherPhone, setShowOtherPhone] = useState(false)
  const [otherPhone, setOtherPhone] = useState('')
  const [smsConsent, setSmsConsent] = useState(false)

  // Address fields (controlled for autocomplete + Places autofill)
  const [addrStreet, setAddrStreet] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrState, setAddrState] = useState('')
  const [addrZip, setAddrZip] = useState('')
  const [addrCountry, setAddrCountry] = useState('US')

  // Google Places autofill state
  const [addressAutoFilled, setAddressAutoFilled] = useState<string | null>(null)
  const [lookingUpAddress, setLookingUpAddress] = useState(false)
  const placesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleNotesTranscript = useCallback((text: string) => {
    if (notesRef.current) {
      notesRef.current.value += (notesRef.current.value ? ' ' : '') + text
    }
  }, [])

  function resetAll() {
    formRef.current?.reset()
    setMobilePhone(''); setWorkPhone(''); setOtherPhone(''); setShowOtherPhone(false)
    setSmsConsent(false)
    setAddrStreet(''); setAddrCity(''); setAddrState(''); setAddrZip(''); setAddrCountry('US')
    setAddressAutoFilled(null)
  }

  // Google Places business lookup — called on company name blur/debounce
  async function lookupCompanyAddress(companyName: string) {
    if (companyName.length < 3) return
    // Only autofill if address fields are empty
    if (addrStreet || addrCity || addrState || addrZip) return

    setLookingUpAddress(true)
    try {
      const res = await fetch(`/api/places/business-lookup?q=${encodeURIComponent(companyName)}`)
      const data = await res.json()
      if (data?.city || data?.street) {
        setAddrStreet(data.street || '')
        setAddrCity(data.city || '')
        setAddrState(data.state || '')
        setAddrZip(data.zip || '')
        setAddrCountry(data.country || 'US')
        setAddressAutoFilled(companyName)
      }
    } catch {
      // silently fail
    } finally {
      setLookingUpAddress(false)
    }
  }

  function handleCompanyBlur(value: string) {
    if (placesDebounceRef.current) clearTimeout(placesDebounceRef.current)
    placesDebounceRef.current = setTimeout(() => lookupCompanyAddress(value), 300)
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    // Inject controlled phone values
    formData.set('phone', mobilPhone)
    formData.set('phone2', workPhone)
    formData.set('sms_consent', smsConsent ? 'true' : 'false')
    // Inject address values
    formData.set('street', addrStreet)
    formData.set('city', addrCity)
    formData.set('state', addrState)
    formData.set('zip', addrZip)
    formData.set('country', addrCountry)
    startTransition(async () => {
      const result = await createCustomer(orgId, orgSlug, formData)
      if (result.error) {
        setError(result.error)
      } else {
        resetAll()
        setOpen(false)
        onSuccess?.()
      }
    })
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setError(null) }}
        className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-qm-fuchsia focus:ring-offset-2"
      >
        Add Customer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8 px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !isPending && setOpen(false)} />

          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Add Customer</h2>
                <p className="mt-0.5 text-sm text-gray-500">Company name, contact, and phone are required.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={isPending} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleSubmit(new FormData(e.currentTarget)); }}>
              <div className="px-6 py-5 space-y-6">
                {error && (
                  <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
                )}

                {/* ── 1. COMPANY NAME ── */}
                <div>
                  <Lbl required>Company name</Lbl>
                  <input
                    name="company_name"
                    type="text"
                    autoFocus
                    maxLength={120}
                    placeholder="Acme Corp"
                    className={ic}
                    onBlur={(e) => handleCompanyBlur(e.target.value)}
                  />
                </div>

                {/* ── 2. ADDRESS ── */}
                <div className="space-y-3">
                  <SectionHead title="Address" />

                  {/* Google autofill banner */}
                  {lookingUpAddress && (
                    <p className="text-xs text-gray-400">Looking up address from Google…</p>
                  )}
                  {addressAutoFilled && (
                    <div className="flex items-start gap-2 rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2">
                      <svg className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                      </svg>
                      <span className="flex-1 text-xs text-yellow-800">
                        Address auto-filled from Google for &ldquo;{addressAutoFilled}&rdquo; — please confirm or edit.
                      </span>
                      <button type="button" onClick={() => setAddressAutoFilled(null)} className="text-yellow-600 hover:text-yellow-800">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )}

                  <div>
                    <Lbl>Street</Lbl>
                    <AddressAutocomplete
                      name="street_autocomplete"
                      defaultValue={addrStreet}
                      className={ic}
                      onSelect={(addr) => {
                        setAddrStreet(addr.street)
                        setAddrCity(addr.city)
                        setAddrState(addr.state)
                        setAddrZip(addr.zip)
                        setAddrCountry(addr.country)
                        setAddressAutoFilled(null)
                      }}
                    />
                    {/* Hidden input carries the final value */}
                    <input type="hidden" name="street" value={addrStreet} />
                  </div>

                  <div><Lbl>Street 2</Lbl><input name="street2" type="text" placeholder="Suite 100" className={ic} /></div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-1">
                      <Lbl>City</Lbl>
                      <input name="city" type="text" value={addrCity} onChange={(e) => setAddrCity(e.target.value)} className={ic} />
                    </div>
                    <div>
                      <Lbl>State</Lbl>
                      <input name="state" type="text" maxLength={2} value={addrState} onChange={(e) => setAddrState(e.target.value)} placeholder="TX" className={ic} />
                    </div>
                    <div>
                      <Lbl>Zip</Lbl>
                      <input name="zip" type="text" value={addrZip} onChange={(e) => setAddrZip(e.target.value)} className={ic} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Lbl>Country</Lbl>
                      <input name="country" type="text" maxLength={2} value={addrCountry} onChange={(e) => setAddrCountry(e.target.value)} placeholder="US" className={ic} />
                    </div>
                    <div>
                      <Lbl>Attention To</Lbl>
                      <input name="attention_to" type="text" className={ic} />
                    </div>
                  </div>
                </div>

                {/* ── 3. PRIMARY CONTACT ── */}
                <div className="space-y-3">
                  <SectionHead title="Primary Contact" />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl required>First name</Lbl>
                      <input name="first_name" type="text" maxLength={80} placeholder="Jane" className={ic} />
                    </div>
                    <div>
                      <Lbl required>Last name</Lbl>
                      <input name="last_name" type="text" maxLength={80} placeholder="Smith" className={ic} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl>Email</Lbl>
                      <input name="email" type="email" maxLength={200} placeholder="jane@example.com" className={ic} />
                    </div>
                    <div>
                      <Lbl>Website</Lbl>
                      <input name="website" type="text" maxLength={200} placeholder="https://…" className={ic} />
                    </div>
                  </div>
                </div>

                {/* ── 4. PHONE NUMBERS ── */}
                <div className="space-y-3">
                  <SectionHead title="Phone Numbers" />

                  {/* Mobile — SMS */}
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-sm font-medium text-gray-700">Mobile</label>
                      <svg className="h-3.5 w-3.5 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3" />
                      </svg>
                    </div>
                    <PhoneInput name="phone" value={mobilPhone} onChange={setMobilePhone} placeholder="Mobile number" />
                    <p className="mt-1 text-xs text-gray-400">Used for SMS notifications</p>
                  </div>

                  {/* Work */}
                  <div>
                    <Lbl>Work</Lbl>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2">
                        <PhoneInput name="phone2" value={workPhone} onChange={setWorkPhone} placeholder="Work number" />
                      </div>
                      <div>
                        <input name="phone_ext" type="text" maxLength={6} placeholder="Ext." className={ic} />
                      </div>
                    </div>
                  </div>

                  {/* Other — collapsed */}
                  {showOtherPhone ? (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Lbl>Other</Lbl>
                        <button type="button" onClick={() => { setShowOtherPhone(false); setOtherPhone('') }} className="text-xs text-gray-400 hover:text-gray-600">Remove</button>
                      </div>
                      <PhoneInput value={otherPhone} onChange={setOtherPhone} placeholder="Other number" />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowOtherPhone(true)}
                      className="text-sm text-qm-lime hover:underline font-medium"
                    >
                      + Add another number
                    </button>
                  )}

                  {/* SMS Consent */}
                  <div className="pt-1">
                    <input type="hidden" name="sms_consent" value={smsConsent ? 'true' : 'false'} />
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smsConsent}
                        onChange={(e) => setSmsConsent(e.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-qm-lime"
                      />
                      <span className="text-xs text-gray-600 leading-relaxed">
                        Yes, I agree to receive automated text messages from Quarter Mile Inc. about
                        my quotes, design proofs, and order updates. Message frequency varies per order
                        (typically 2–5 messages). Message and data rates may apply. Reply HELP for help
                        or STOP to cancel.{' '}
                        <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-qm-lime">Terms</a>
                        {' | '}
                        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-qm-lime">Privacy</a>.
                        {' '}Consent is not required to make a purchase.
                      </span>
                    </label>
                  </div>
                </div>

                {/* ── 5-9. OTHER FIELDS ── */}
                <div className="space-y-4">
                  <SectionHead title="Details" />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl>Industry</Lbl>
                      <select name="industry" className={sc}>
                        <option value="">— None —</option>
                        {INDUSTRY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <Lbl>Status</Lbl>
                      <select name="status" defaultValue="lead" className={sc}>
                        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl>Lead Source</Lbl>
                      <select name="lead_source" className={sc}>
                        <option value="">— None —</option>
                        {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <Lbl>Sales Rep</Lbl>
                      <select name="sales_rep_id" className={sc}>
                        <option value="">— None —</option>
                        {salesReps.map((r) => (
                          <option key={r.id} value={r.id}>{r.full_name ?? r.id}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Lbl>Notes</Lbl>
                      <VoiceInput onTranscript={handleNotesTranscript} />
                    </div>
                    <textarea ref={notesRef} name="notes" rows={3} maxLength={1000} placeholder="Any additional notes…" className={ic} />
                  </div>

                  {/* Payment terms — tucked at bottom */}
                  <div className="grid grid-cols-2 gap-4 pt-1 border-t border-gray-100">
                    <div>
                      <Lbl>Payment Terms</Lbl>
                      <select name="payment_terms" className={sc}>
                        {PAYMENT_TERMS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <Lbl>Tax Rate</Lbl>
                      <select name="tax_rate" className={sc}>
                        <option value="">None</option>
                        <option value="8.25">8.25% (TX Standard)</option>
                        <option value="8">8%</option>
                        <option value="7">7%</option>
                        <option value="6">6%</option>
                        <option value="exempt">Exempt</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
                <button type="button" onClick={() => setOpen(false)} disabled={isPending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                  Cancel
                </button>
                <button type="submit" disabled={isPending} className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                  {isPending ? 'Saving…' : 'Add Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
