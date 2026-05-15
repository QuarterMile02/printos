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
}

const LEAD_SOURCES = ['Referral', 'Walk-in', 'Google', 'Social Media', 'Trade Show', 'Cold Call', 'Website', 'Other']
const PAYMENT_TERMS_OPTIONS = ['60/40', 'Net 30', 'Net 45', 'Due on Receipt', 'CC']
const STATUS_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'closable', label: 'Closable' },
  { value: 'sold', label: 'Sold' },
]

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
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 pb-1.5 mb-3">{title}</p>
  )
}

function CollapseToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 text-sm font-medium text-qm-lime hover:text-qm-lime-dark transition-colors"
    >
      <svg className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
      {label}
    </button>
  )
}

export default function CreateCustomerForm({ orgId, orgSlug, salesReps, initialOpen = false }: Props) {
  const [open, setOpen] = useState(initialOpen)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  // Controlled fields
  const [phone, setPhone] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrState, setAddrState] = useState('')
  const [addrZip, setAddrZip] = useState('')
  const [addrCountry, setAddrCountry] = useState('US')
  const [secCity, setSecCity] = useState('')
  const [secState, setSecState] = useState('')
  const [secZip, setSecZip] = useState('')
  const [secCountry, setSecCountry] = useState('US')
  const [taxable, setTaxable] = useState(true)
  const [smsConsent, setSmsConsent] = useState(false)

  // Section visibility
  const [showSecondary, setShowSecondary] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [showNotes, setShowNotes] = useState(false)

  const handleNotesTranscript = useCallback((text: string) => {
    if (notesRef.current) {
      notesRef.current.value += (notesRef.current.value ? ' ' : '') + text
    }
  }, [])

  function resetAll() {
    formRef.current?.reset()
    setPhone('')
    setAddrCity(''); setAddrState(''); setAddrZip(''); setAddrCountry('US')
    setSecCity(''); setSecState(''); setSecZip(''); setSecCountry('US')
    setTaxable(true)
    setSmsConsent(false)
    setShowSecondary(false); setShowAccount(false); setShowNotes(false)
  }

  function handleSubmit(formData: FormData) {
    setError(null)
    startTransition(async () => {
      const result = await createCustomer(orgId, orgSlug, formData)
      if (result.error) {
        setError(result.error)
      } else {
        resetAll()
        setOpen(false)
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
                <p className="mt-0.5 text-sm text-gray-500">Fill in the details below. Only name is required.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={isPending} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form ref={formRef} action={handleSubmit}>
              <div className="px-6 py-5 space-y-6">
                {error && (
                  <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
                )}

                {/* ── CONTACT INFO ── */}
                <div className="space-y-4">
                  <SectionHead title="Contact Info" />

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl required>First name</Lbl>
                      <input id="first_name" name="first_name" type="text" required autoFocus maxLength={80} placeholder="Jane" className={ic} />
                    </div>
                    <div>
                      <Lbl required>Last name</Lbl>
                      <input id="last_name" name="last_name" type="text" required maxLength={80} placeholder="Smith" className={ic} />
                    </div>
                  </div>

                  <div>
                    <Lbl>Company name</Lbl>
                    <input name="company_name" type="text" maxLength={120} placeholder="Acme Corp" className={ic} />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Lbl>Email</Lbl>
                      <input name="email" type="email" maxLength={200} placeholder="jane@example.com" className={ic} />
                    </div>
                    <div>
                      <Lbl>Website</Lbl>
                      <input name="website" type="url" maxLength={200} placeholder="https://…" className={ic} />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <Lbl>Phone</Lbl>
                      <PhoneInput
                        name="phone"
                        value={phone}
                        onChange={setPhone}
                        placeholder="1234567890"
                      />
                    </div>
                    <div>
                      <Lbl>Ext.</Lbl>
                      <input name="phone_ext" type="text" maxLength={10} placeholder="123" className={ic} />
                    </div>
                  </div>

                  <div>
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
                        or STOP to cancel anytime.{' '}
                        <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-qm-lime">Terms</a>
                        {' | '}
                        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-qm-lime">Privacy</a>.
                        {' '}Consent is not required to make a purchase.
                      </span>
                    </label>
                  </div>
                </div>

                {/* ── PRIMARY ADDRESS ── */}
                <div className="space-y-3">
                  <SectionHead title="Primary Address (Bill To)" />

                  <div>
                    <Lbl>Street</Lbl>
                    <AddressAutocomplete
                      name="street"
                      className={ic}
                      onSelect={(addr) => {
                        setAddrCity(addr.city)
                        setAddrState(addr.state)
                        setAddrZip(addr.zip)
                        setAddrCountry(addr.country)
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Lbl>Street 2</Lbl>
                      <input name="street2" type="text" placeholder="Suite 100" className={ic} />
                    </div>
                    <div>
                      <Lbl>Suburb</Lbl>
                      <input name="suburb" type="text" className={ic} />
                    </div>
                  </div>

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

                {/* ── SECONDARY ADDRESS (collapsible) ── */}
                <div className="space-y-3">
                  <CollapseToggle
                    open={showSecondary}
                    onToggle={() => setShowSecondary((v) => !v)}
                    label={showSecondary ? 'Remove secondary address' : 'Add Ship To / Secondary Address'}
                  />
                  {showSecondary && (
                    <div className="space-y-3 pl-1 border-l-2 border-qm-lime-light">
                      <SectionHead title="Secondary Address (Ship To)" />
                      <div>
                        <Lbl>Street</Lbl>
                        <AddressAutocomplete
                          name="secondary_street"
                          className={ic}
                          onSelect={(addr) => {
                            setSecCity(addr.city)
                            setSecState(addr.state)
                            setSecZip(addr.zip)
                            setSecCountry(addr.country)
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div><Lbl>Street 2</Lbl><input name="secondary_street2" type="text" className={ic} /></div>
                        <div><Lbl>Suburb</Lbl><input name="secondary_suburb" type="text" className={ic} /></div>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-1">
                          <Lbl>City</Lbl>
                          <input name="secondary_city" type="text" value={secCity} onChange={(e) => setSecCity(e.target.value)} className={ic} />
                        </div>
                        <div>
                          <Lbl>State</Lbl>
                          <input name="secondary_state" type="text" maxLength={2} value={secState} onChange={(e) => setSecState(e.target.value)} className={ic} />
                        </div>
                        <div>
                          <Lbl>Zip</Lbl>
                          <input name="secondary_zip" type="text" value={secZip} onChange={(e) => setSecZip(e.target.value)} className={ic} />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Lbl>Country</Lbl>
                          <input name="secondary_country" type="text" maxLength={2} value={secCountry} onChange={(e) => setSecCountry(e.target.value)} placeholder="US" className={ic} />
                        </div>
                        <div>
                          <Lbl>Attention To</Lbl>
                          <input name="secondary_attention_to" type="text" className={ic} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── ACCOUNT & TAX (collapsible) ── */}
                <div className="space-y-3">
                  <CollapseToggle
                    open={showAccount}
                    onToggle={() => setShowAccount((v) => !v)}
                    label={showAccount ? 'Hide account details' : 'Add Account & Tax Details'}
                  />
                  {showAccount && (
                    <div className="space-y-4 pl-1 border-l-2 border-qm-lime-light">
                      <SectionHead title="Account & Tax" />

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Lbl>Status</Lbl>
                          <select name="status" defaultValue="lead" className={sc}>
                            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Lbl>Industry</Lbl>
                          <input name="industry" type="text" className={ic} />
                        </div>
                        <div>
                          <Lbl>Lead Source</Lbl>
                          <select name="lead_source" className={sc}>
                            <option value="">— None —</option>
                            {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Lbl>Payment Terms</Lbl>
                          <select name="payment_terms" className={sc}>
                            {PAYMENT_TERMS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <Lbl>Pricing Level</Lbl>
                          <input name="pricing_level" type="text" className={ic} />
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <Lbl>Credit Limit ($)</Lbl>
                          <input name="credit_limit" type="number" step="0.01" min={0} defaultValue="" placeholder="0.00" className={ic} />
                        </div>
                        <div>
                          <Lbl>Tax Rate</Lbl>
                          <select name="tax_rate" className={sc}>
                            <option value="">None</option>
                            <option value="8.25">8.25% (TX Standard)</option>
                            <option value="8">8%</option>
                            <option value="7">7%</option>
                            <option value="6">6%</option>
                            <option value="5">5%</option>
                            <option value="exempt">Exempt</option>
                          </select>
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                            <input type="hidden" name="taxable" value={taxable ? 'true' : 'false'} />
                            <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                            Taxable
                          </label>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Lbl>Tax Exempt Code</Lbl>
                          <input name="tax_exempt_code" type="text" className={ic} />
                        </div>
                        <div>
                          <Lbl>Tax Exempt Expires</Lbl>
                          <input name="tax_exempt_expires_at" type="date" className={ic} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Lbl>VAT Number</Lbl>
                          <input name="vat_number" type="text" className={ic} />
                        </div>
                        <div>
                          <Lbl>AP Contact</Lbl>
                          <input name="ap_contact" type="text" className={ic} />
                        </div>
                      </div>

                      <div>
                        <Lbl>Tags</Lbl>
                        <input name="tags" type="text" placeholder="e.g. VIP, wholesale, reseller" className={ic} />
                        <p className="mt-1 text-xs text-gray-400">Separate with commas</p>
                      </div>

                      <div>
                        <Lbl>Background Info</Lbl>
                        <textarea name="background_info" rows={2} className={ic} />
                      </div>

                      <div>
                        <Lbl>Special Notes</Lbl>
                        <textarea name="special_notes" rows={2} className={ic} />
                      </div>
                    </div>
                  )}
                </div>

                {/* ── NOTES (collapsible) ── */}
                <div className="space-y-3">
                  <CollapseToggle
                    open={showNotes}
                    onToggle={() => setShowNotes((v) => !v)}
                    label={showNotes ? 'Hide notes' : 'Add Notes'}
                  />
                  {showNotes && (
                    <div className="space-y-3 pl-1 border-l-2 border-qm-lime-light">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <Lbl>Notes</Lbl>
                          <VoiceInput onTranscript={handleNotesTranscript} />
                        </div>
                        <textarea ref={notesRef} name="notes" rows={3} maxLength={1000} placeholder="Any additional notes…" className={ic} />
                      </div>
                      <div>
                        <Lbl>Other Info</Lbl>
                        <textarea name="other_info" rows={2} className={ic} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                  className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
                >
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
