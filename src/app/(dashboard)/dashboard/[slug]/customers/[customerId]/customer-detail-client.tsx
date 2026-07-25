'use client'

import { useState, useTransition, useCallback, useEffect } from 'react'
import { updateCustomer, type CustomerUpdatePayload } from '../actions'
import VoiceInput from '@/components/voice-input'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import PhoneInput from '@/components/ui/PhoneInput'

// ── Types ─────────────────────────────────────────────────────────────────────

type PrimaryContact = {
  full_name: string
  email: string | null
  phone: string | null
  title: string | null
} | null

type CustomerData = {
  first_name: string; last_name: string; company_name: string | null
  email: string | null; phone: string | null; phone2: string | null; phone_ext: string | null
  notes: string | null; legal_name: string | null; sales_rep: string | null
  industry: string | null; lead_source: string | null; customer_group: string | null
  status: string | null; is_active: boolean | null
  street: string | null; street2: string | null
  city: string | null; state: string | null; zip: string | null; country: string | null
  secondary_street: string | null; secondary_city: string | null
  secondary_state: string | null; secondary_zip: string | null; secondary_country: string | null
  terms: string | null; taxable: boolean | null
  tax_exempt_code: string | null; tax_exempt_expires: string | null
  credit_limit: number | null; pricing_level: string | null
  discount_percent: number | null; website: string | null
  allow_credit_card_payments: boolean | null
  background_info: string | null; special_notes: string | null
  sms_consent: boolean | null
  portal_enabled: boolean | null
  portal_tier_id: string | null
}

type PortalTierOption = { id: string; name: string }

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  initialData: CustomerData
  initialPrimaryContact: PrimaryContact
  contactsSlot?: React.ReactNode
  portalTiers?: PortalTierOption[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

const STATUS_BADGE: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700',
  prospect: 'bg-yellow-50 text-yellow-700',
  closable: 'bg-blue-50 text-blue-700',
  sold: 'bg-qm-lime-light text-qm-lime-dark',
}

const TERMS_OPTIONS = ['60/40', 'Net 30', 'Net 45', 'Due on Receipt', 'CC']

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const sc = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime bg-white'

// ── Helper components ─────────────────────────────────────────────────────────

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {children}{required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  )
}
function Dash() { return <span className="text-gray-300">—</span> }

function CardActions({
  editing, saved, pending, onEdit, onCancel, onSave,
}: {
  editing: boolean; saved: boolean; pending: boolean
  onEdit: () => void; onCancel: () => void; onSave: () => void
}) {
  return !editing ? (
    <div className="flex items-center gap-2">
      {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
      <button
        onClick={onEdit}
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-qm-black hover:bg-qm-surface transition-colors"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
        </svg>
        Edit
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <button onClick={onCancel} disabled={pending} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
      <button onClick={onSave} disabled={pending} className="rounded-md bg-qm-lime px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
        {pending ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CustomerDetailClient({
  customerId, orgId, orgSlug, initialData, initialPrimaryContact, contactsSlot,
  portalTiers = [],
}: Props) {
  const [data, setData] = useState<CustomerData>(initialData)

  // ── Portal card state
  const [portalEditing, setPortalEditing] = useState(false)
  const [portalDraft, setPortalDraft] = useState<CustomerData>(initialData)
  const [portalSaved, setPortalSaved] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [portalPending, startPortalTransition] = useTransition()

  // ── Address card state
  const [addrEditing, setAddrEditing] = useState(false)
  const [addrDraft, setAddrDraft] = useState<CustomerData>(initialData)
  const [addrSaved, setAddrSaved] = useState(false)
  const [addrError, setAddrError] = useState<string | null>(null)
  const [addrPending, startAddrTransition] = useTransition()

  // ── Customer Details card state
  const [detailEditing, setDetailEditing] = useState(false)
  const [detailDraft, setDetailDraft] = useState<CustomerData>(initialData)
  const [detailSaved, setDetailSaved] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailPending, startDetailTransition] = useTransition()

  // ── Account Info card state
  const [acctEditing, setAcctEditing] = useState(false)
  const [acctDraft, setAcctDraft] = useState<CustomerData>(initialData)
  const [acctSaved, setAcctSaved] = useState(false)
  const [acctError, setAcctError] = useState<string | null>(null)
  const [acctPending, startAcctTransition] = useTransition()

  // Pencil button (in CustomerActionMenu) dispatches this event to open both cards
  useEffect(() => {
    function handler() {
      setAddrDraft((d) => d) // keep current draft
      setDetailDraft((d) => d)
      setAddrDraft({ ...data })
      setDetailDraft({ ...data })
      setAddrEditing(true)
      setDetailEditing(true)
      setAddrError(null)
      setDetailError(null)
    }
    window.addEventListener('customer:open-edit', handler)
    return () => window.removeEventListener('customer:open-edit', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const handleNotesVoice = useCallback((text: string) => {
    setDetailDraft((prev) => ({ ...prev, notes: (prev.notes ? prev.notes + ' ' : '') + text }))
  }, [])

  async function save(payload: CustomerUpdatePayload): Promise<{ error?: string }> {
    return updateCustomer(customerId, orgId, orgSlug, payload)
  }

  function flash(setter: (v: boolean) => void) {
    setter(true)
    setTimeout(() => setter(false), 3000)
  }

  // ── Address save
  function saveAddr() {
    setAddrError(null)
    startAddrTransition(async () => {
      const res = await save({
        street: addrDraft.street, street2: addrDraft.street2,
        city: addrDraft.city, state: addrDraft.state, zip: addrDraft.zip,
        country: addrDraft.country,
        secondary_street: addrDraft.secondary_street,
        secondary_city: addrDraft.secondary_city,
        secondary_state: addrDraft.secondary_state,
        secondary_zip: addrDraft.secondary_zip,
        secondary_country: addrDraft.secondary_country,
      })
      if (res.error) { setAddrError(res.error); return }
      setData((d) => ({ ...d, ...addrDraft }))
      setAddrEditing(false)
      flash(setAddrSaved)
    })
  }

  // ── Customer Details save
  function saveDetail() {
    setDetailError(null)
    startDetailTransition(async () => {
      const res = await save({
        first_name: detailDraft.first_name,
        last_name: detailDraft.last_name,
        company_name: detailDraft.company_name,
        email: detailDraft.email,
        phone: detailDraft.phone,
        phone2: detailDraft.phone2,
        phone_ext: detailDraft.phone_ext,
        sms_consent: detailDraft.sms_consent,
        notes: detailDraft.notes,
        industry: detailDraft.industry,
        lead_source: detailDraft.lead_source,
        status: detailDraft.status,
        is_active: detailDraft.is_active,
        legal_name: detailDraft.legal_name,
        sales_rep: detailDraft.sales_rep,
        customer_group: detailDraft.customer_group,
      })
      if (res.error) { setDetailError(res.error); return }
      setData((d) => ({ ...d, ...detailDraft }))
      setDetailEditing(false)
      flash(setDetailSaved)
    })
  }

  // ── Account Info save
  function saveAcct() {
    setAcctError(null)
    startAcctTransition(async () => {
      const res = await save({
        terms: acctDraft.terms,
        taxable: acctDraft.taxable,
        tax_exempt_code: acctDraft.tax_exempt_code,
        tax_exempt_expires: acctDraft.tax_exempt_expires,
        credit_limit: acctDraft.credit_limit,
        pricing_level: acctDraft.pricing_level,
        discount_percent: acctDraft.discount_percent,
        website: acctDraft.website,
        allow_credit_card_payments: acctDraft.allow_credit_card_payments,
        background_info: acctDraft.background_info,
        special_notes: acctDraft.special_notes,
        sales_rep: acctDraft.sales_rep,
      })
      if (res.error) { setAcctError(res.error); return }
      setData((d) => ({ ...d, ...acctDraft }))
      setAcctEditing(false)
      flash(setAcctSaved)
    })
  }

  // ── Portal save
  function savePortal() {
    setPortalError(null)
    startPortalTransition(async () => {
      const res = await save({
        portal_enabled: portalDraft.portal_enabled,
        portal_tier_id: portalDraft.portal_tier_id,
      })
      if (res.error) { setPortalError(res.error); return }
      setData((d) => ({ ...d, portal_enabled: portalDraft.portal_enabled, portal_tier_id: portalDraft.portal_tier_id }))
      setPortalEditing(false)
      flash(setPortalSaved)
    })
  }

  const primaryAddr = [data.street, data.city, data.state, data.zip].some(Boolean)
  const secondaryAddr = [data.secondary_street, data.secondary_city].some(Boolean)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── 1. ADDRESS CARD (first) — Edit triggered by top pencil only ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Address</h2>
          {/* Save/Cancel only shown when in edit mode — no standalone Edit button */}
          {addrEditing && (
            <div className="flex items-center gap-2">
              {addrSaved && <span className="text-sm text-green-600 font-medium">Saved</span>}
              <button onClick={() => { setAddrEditing(false); setAddrError(null) }} disabled={addrPending} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={saveAddr} disabled={addrPending} className="rounded-md bg-qm-lime px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {addrPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
        {addrError && <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{addrError}</div>}

        {addrEditing ? (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-2">Bill To / Primary</p>
              <div className="space-y-3">
                <div>
                  <Label>Street</Label>
                  <AddressAutocomplete
                    defaultValue={addrDraft.street ?? ''}
                    className={ic}
                    onSelect={(addr) => setAddrDraft((prev) => ({
                      ...prev,
                      street: addr.street || prev.street,
                      city: addr.city || prev.city,
                      state: addr.state || prev.state,
                      zip: addr.zip || prev.zip,
                      country: addr.country || prev.country,
                    }))}
                  />
                </div>
                <div><Label>Street 2</Label><input type="text" value={addrDraft.street2 ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, street2: e.target.value || null })} className={ic} placeholder="Suite 100" /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1"><Label>City</Label><input type="text" value={addrDraft.city ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, city: e.target.value || null })} className={ic} /></div>
                  <div><Label>State</Label><input type="text" value={addrDraft.state ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, state: e.target.value || null })} className={ic} maxLength={2} placeholder="TX" /></div>
                  <div><Label>Zip</Label><input type="text" value={addrDraft.zip ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, zip: e.target.value || null })} className={ic} /></div>
                </div>
                <div><Label>Country</Label><input type="text" value={addrDraft.country ?? 'US'} onChange={(e) => setAddrDraft({ ...addrDraft, country: e.target.value || null })} className={ic} maxLength={2} placeholder="US" /></div>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-2">Ship To / Install</p>
              <div className="space-y-3">
                <div>
                  <Label>Street</Label>
                  <AddressAutocomplete
                    defaultValue={addrDraft.secondary_street ?? ''}
                    className={ic}
                    onSelect={(addr) => setAddrDraft((prev) => ({
                      ...prev,
                      secondary_street: addr.street || prev.secondary_street,
                      secondary_city: addr.city || prev.secondary_city,
                      secondary_state: addr.state || prev.secondary_state,
                      secondary_zip: addr.zip || prev.secondary_zip,
                      secondary_country: addr.country || prev.secondary_country,
                    }))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1"><Label>City</Label><input type="text" value={addrDraft.secondary_city ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, secondary_city: e.target.value || null })} className={ic} /></div>
                  <div><Label>State</Label><input type="text" value={addrDraft.secondary_state ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, secondary_state: e.target.value || null })} className={ic} maxLength={2} /></div>
                  <div><Label>Zip</Label><input type="text" value={addrDraft.secondary_zip ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, secondary_zip: e.target.value || null })} className={ic} /></div>
                </div>
                <div><Label>Country</Label><input type="text" value={addrDraft.secondary_country ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, secondary_country: e.target.value || null })} className={ic} maxLength={2} placeholder="US" /></div>
              </div>
            </div>
          </div>
        ) : !primaryAddr && !secondaryAddr ? (
          <p className="text-sm text-qm-gray">No address on file</p>
        ) : (
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-1">Bill To</p>
              {primaryAddr ? (
                <address className="not-italic leading-relaxed text-qm-black">
                  {data.street && <div>{data.street}</div>}
                  {data.street2 && <div>{data.street2}</div>}
                  {(data.city || data.state || data.zip) && (
                    <div>{[data.city, data.state, data.zip].filter(Boolean).join(', ')}</div>
                  )}
                  {data.country && data.country !== 'US' && <div>{data.country}</div>}
                </address>
              ) : <span className="text-qm-gray">—</span>}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-1">Ship To / Install</p>
              {secondaryAddr ? (
                <address className="not-italic leading-relaxed text-qm-black">
                  {data.secondary_street && <div>{data.secondary_street}</div>}
                  {(data.secondary_city || data.secondary_state || data.secondary_zip) && (
                    <div>{[data.secondary_city, data.secondary_state, data.secondary_zip].filter(Boolean).join(', ')}</div>
                  )}
                  {data.secondary_country && data.secondary_country !== 'US' && <div>{data.secondary_country}</div>}
                </address>
              ) : <span className="text-qm-gray">—</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── 2. CUSTOMER DETAILS CARD (second) — Edit triggered by top pencil only ── */}
      <div id="section-customer-details" className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Customer Details</h2>
          {detailEditing && (
            <div className="flex items-center gap-2">
              {detailSaved && <span className="text-sm text-green-600 font-medium">Saved</span>}
              <button onClick={() => { setDetailEditing(false); setDetailError(null) }} disabled={detailPending} className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={saveDetail} disabled={detailPending} className="rounded-md bg-qm-lime px-4 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {detailPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
        {detailError && <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{detailError}</div>}

        {detailEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div><Label required>First name</Label>
                <input type="text" value={detailDraft.first_name} onChange={(e) => setDetailDraft({ ...detailDraft, first_name: e.target.value })} className={ic} />
              </div>
              <div><Label required>Last name</Label>
                <input type="text" value={detailDraft.last_name} onChange={(e) => setDetailDraft({ ...detailDraft, last_name: e.target.value })} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Company</Label>
                <input type="text" value={detailDraft.company_name ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, company_name: e.target.value || null })} className={ic} />
              </div>
              <div><Label>Email</Label>
                <input type="email" value={detailDraft.email ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, email: e.target.value || null })} className={ic} />
              </div>
            </div>

            {/* Mobile phone */}
            <div>
              <Label>
                Mobile
                <span className="ml-1.5 text-xs font-normal text-gray-400">— SMS notifications</span>
              </Label>
              <PhoneInput
                value={detailDraft.phone ?? ''}
                onChange={(val) => setDetailDraft({ ...detailDraft, phone: val.replace(/\D/g, '').length > 3 ? val : null })}
              />
            </div>

            {/* Work phone + ext */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Work phone</Label>
                <PhoneInput
                  value={detailDraft.phone2 ?? ''}
                  onChange={(val) => setDetailDraft({ ...detailDraft, phone2: val.replace(/\D/g, '').length > 3 ? val : null })}
                />
              </div>
              <div><Label>Ext.</Label>
                <input type="text" value={detailDraft.phone_ext ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, phone_ext: e.target.value || null })} maxLength={10} placeholder="123" className={ic} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div><Label>Industry</Label>
                <select value={detailDraft.industry ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, industry: e.target.value || null })} className={sc}>
                  <option value="">— None —</option>
                  {INDUSTRY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div><Label>Status</Label>
                <select value={detailDraft.status ?? 'lead'} onChange={(e) => setDetailDraft({ ...detailDraft, status: e.target.value })} className={sc}>
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            <div><Label>Lead Source</Label>
              <input type="text" value={detailDraft.lead_source ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, lead_source: e.target.value || null })} className={ic} />
            </div>

            {/* SMS Consent */}
            <div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={detailDraft.sms_consent ?? false}
                  onChange={(e) => setDetailDraft({ ...detailDraft, sms_consent: e.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-qm-lime"
                />
                <span className="text-xs text-gray-600 leading-relaxed">
                  SMS Consent — customer agrees to receive automated text messages.{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-qm-lime">Terms</a>
                  {' | '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-qm-lime">Privacy</a>
                </span>
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Notes</Label>
                <VoiceInput onTranscript={handleNotesVoice} />
              </div>
              <textarea value={detailDraft.notes ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, notes: e.target.value || null })} rows={3} className={ic} />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Primary Contact section */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-2">Primary Contact</p>
              {initialPrimaryContact ? (
                <div className="space-y-0.5 text-sm">
                  <p className="font-semibold text-qm-black">{initialPrimaryContact.full_name}</p>
                  {initialPrimaryContact.title && <p className="text-xs text-qm-gray">{initialPrimaryContact.title}</p>}
                  {initialPrimaryContact.email && (
                    <a href={`mailto:${initialPrimaryContact.email}`} className="block text-qm-lime hover:underline">{initialPrimaryContact.email}</a>
                  )}
                  {initialPrimaryContact.phone && (
                    <a href={`tel:${initialPrimaryContact.phone}`} className="block hover:underline">{initialPrimaryContact.phone}</a>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 italic">No primary contact assigned</p>
              )}
            </div>

            {/* Details fields */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm border-t border-gray-100 pt-4">
              {data.industry && (
                <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Industry</dt><dd className="mt-0.5">{data.industry}</dd></div>
              )}
              {data.status && (
                <div>
                  <dt className="text-qm-gray text-xs uppercase tracking-wide">Status</dt>
                  <dd className="mt-0.5">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[data.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {data.status}
                    </span>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-qm-gray text-xs uppercase tracking-wide">SMS Consent</dt>
                <dd className="mt-0.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${data.sms_consent ? 'bg-qm-lime-light text-qm-lime-dark' : 'bg-gray-100 text-gray-600'}`}>
                    {data.sms_consent ? 'Opted in' : 'Not opted in'}
                  </span>
                </dd>
              </div>
              {data.lead_source && (
                <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Lead Source</dt><dd className="mt-0.5">{data.lead_source}</dd></div>
              )}
              {data.phone && (
                <div>
                  <dt className="text-qm-gray text-xs uppercase tracking-wide">Mobile</dt>
                  <dd className="mt-0.5"><a href={`tel:${data.phone}`} className="hover:underline">{data.phone}</a></dd>
                </div>
              )}
              {data.phone2 && (
                <div>
                  <dt className="text-qm-gray text-xs uppercase tracking-wide">Work</dt>
                  <dd className="mt-0.5">
                    <a href={`tel:${data.phone2}`} className="hover:underline">{data.phone2}</a>
                    {data.phone_ext && <span className="ml-1 text-qm-gray text-xs">ext {data.phone_ext}</span>}
                  </dd>
                </div>
              )}
              {data.notes && (
                <div className="col-span-2 border-t border-gray-100 pt-3 mt-1">
                  <dt className="text-qm-gray text-xs uppercase tracking-wide mb-1">Notes</dt>
                  <dd className="text-sm text-qm-black whitespace-pre-wrap">{data.notes}</dd>
                </div>
              )}
            </dl>
          </div>
        )}
      </div>

      {/* ── 3. CONTACTS SLOT (injected from page) ── */}
      {contactsSlot}

      {/* ── 4. ACCOUNT INFO CARD (fourth) ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Account Info</h2>
          <CardActions
            editing={acctEditing} saved={acctSaved} pending={acctPending}
            onEdit={() => { setAcctDraft({ ...data }); setAcctEditing(true); setAcctError(null) }}
            onCancel={() => { setAcctEditing(false); setAcctError(null) }}
            onSave={saveAcct}
          />
        </div>
        {acctError && <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{acctError}</div>}

        {acctEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Terms</Label>
                <select value={acctDraft.terms ?? '60/40'} onChange={(e) => setAcctDraft({ ...acctDraft, terms: e.target.value })} className={sc}>
                  {TERMS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div><Label>Credit Limit ($)</Label>
                <input type="number" step="0.01" min={0} value={acctDraft.credit_limit ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, credit_limit: e.target.value === '' ? null : parseFloat(e.target.value) })} className={ic} />
              </div>
              <div><Label>Discount %</Label>
                <input type="number" step="0.01" min={0} max={100} value={acctDraft.discount_percent ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, discount_percent: e.target.value === '' ? null : parseFloat(e.target.value) })} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="checkbox" checked={acctDraft.taxable ?? true} onChange={(e) => setAcctDraft({ ...acctDraft, taxable: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                  Taxable
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="checkbox" checked={acctDraft.allow_credit_card_payments ?? true} onChange={(e) => setAcctDraft({ ...acctDraft, allow_credit_card_payments: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                  Allow CC Payments
                </label>
              </div>
              <div><Label>Sales Rep</Label>
                <input type="text" value={acctDraft.sales_rep ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, sales_rep: e.target.value || null })} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Pricing Level</Label>
                <input type="text" value={acctDraft.pricing_level ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, pricing_level: e.target.value || null })} className={ic} />
              </div>
              <div><Label>Website</Label>
                <input type="url" value={acctDraft.website ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, website: e.target.value || null })} className={ic} placeholder="https://…" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Tax Exempt Code</Label>
                <input type="text" value={acctDraft.tax_exempt_code ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, tax_exempt_code: e.target.value || null })} className={ic} />
              </div>
              <div><Label>Tax Exempt Expires</Label>
                <input type="date" value={acctDraft.tax_exempt_expires ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, tax_exempt_expires: e.target.value || null })} className={ic} />
              </div>
            </div>
            <div><Label>Background Info</Label>
              <textarea value={acctDraft.background_info ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, background_info: e.target.value || null })} rows={3} className={ic} />
            </div>
            <div><Label>Special Notes</Label>
              <textarea value={acctDraft.special_notes ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, special_notes: e.target.value || null })} rows={3} className={ic} />
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Terms</dt><dd className="font-medium mt-0.5">{data.terms ?? <Dash />}</dd></div>
            <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Credit Limit</dt><dd className="mt-0.5">{data.credit_limit != null ? `$${Number(data.credit_limit).toLocaleString()}` : <Dash />}</dd></div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Tax</dt>
              <dd className="mt-0.5">
                {data.taxable ? 'Taxable' : 'Tax Exempt'}
                {data.tax_exempt_code && <span className="ml-1 text-qm-gray">({data.tax_exempt_code})</span>}
              </dd>
            </div>
            <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Discount %</dt><dd className="mt-0.5">{data.discount_percent != null ? `${data.discount_percent}%` : <Dash />}</dd></div>
            {data.sales_rep && <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Sales Rep</dt><dd className="mt-0.5">{data.sales_rep}</dd></div>}
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">CC Payments</dt>
              <dd className="mt-0.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${data.allow_credit_card_payments !== false ? 'bg-qm-lime-light text-qm-lime-dark' : 'bg-gray-100 text-gray-600'}`}>
                  {data.allow_credit_card_payments !== false ? 'Yes' : 'No'}
                </span>
              </dd>
            </div>
            {data.website && (
              <div className="col-span-2"><dt className="text-qm-gray text-xs uppercase tracking-wide">Website</dt><dd className="mt-0.5"><a href={data.website} target="_blank" rel="noopener noreferrer" className="text-qm-lime hover:underline break-all">{data.website}</a></dd></div>
            )}
            {data.background_info && (
              <div className="col-span-2 border-t border-gray-100 pt-3 mt-1">
                <dt className="text-qm-gray text-xs uppercase tracking-wide mb-1">Background Info</dt>
                <dd className="whitespace-pre-wrap">{data.background_info}</dd>
              </div>
            )}
            {data.special_notes && (
              <div className="col-span-2 border-t border-gray-100 pt-3">
                <dt className="text-qm-gray text-xs uppercase tracking-wide mb-1">Special Notes</dt>
                <dd className="whitespace-pre-wrap">{data.special_notes}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* ── 4. CUSTOMER PORTAL CARD ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Customer Portal</h2>
          <CardActions
            editing={portalEditing}
            saved={portalSaved}
            pending={portalPending}
            onEdit={() => { setPortalDraft({ ...data }); setPortalEditing(true); setPortalError(null) }}
            onCancel={() => { setPortalEditing(false); setPortalError(null) }}
            onSave={savePortal}
          />
        </div>
        {portalError && <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{portalError}</div>}

        {portalEditing ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Portal Access</Label>
                <p className="text-xs text-gray-400">Allow this customer to place orders via the portal</p>
              </div>
              <button
                type="button"
                onClick={() => setPortalDraft((d) => ({ ...d, portal_enabled: !d.portal_enabled }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${portalDraft.portal_enabled ? 'bg-qm-lime' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${portalDraft.portal_enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div>
              <Label>Pricing Tier</Label>
              <select
                value={portalDraft.portal_tier_id ?? ''}
                onChange={(e) => setPortalDraft((d) => ({ ...d, portal_tier_id: e.target.value || null }))}
                className={sc}
              >
                <option value="">— No tier assigned —</option>
                {portalTiers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Portal Access</dt>
              <dd className="mt-0.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${data.portal_enabled ? 'bg-qm-lime-light text-qm-lime-dark' : 'bg-gray-100 text-gray-600'}`}>
                  {data.portal_enabled ? 'Enabled' : 'Disabled'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Pricing Tier</dt>
              <dd className="mt-0.5 font-medium">
                {data.portal_tier_id
                  ? (portalTiers.find((t) => t.id === data.portal_tier_id)?.name ?? data.portal_tier_id)
                  : <Dash />}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  )
}
