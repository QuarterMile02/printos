'use client'

import { useState, useTransition, useCallback } from 'react'
import { updateCustomer, type CustomerUpdatePayload } from '../actions'
import VoiceInput from '@/components/voice-input'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'
import PhoneInput from '@/components/ui/PhoneInput'

// ── Types ─────────────────────────────────────────────────────────────────────

type CustomerData = {
  first_name: string; last_name: string; company_name: string | null
  email: string | null; phone: string | null; notes: string | null
  legal_name: string | null; sales_rep: string | null; industry: string | null
  lead_source: string | null; customer_group: string | null
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
}

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  initialData: CustomerData
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TERMS_OPTIONS = ['60/40', 'Net 30', 'Net 45', 'Due on Receipt', 'CC']
const STATUS_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'closable', label: 'Closable' },
  { value: 'sold', label: 'Sold' },
]

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'
const sc = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime bg-white'

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {children}{required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  )
}
function Dash() { return <span className="text-gray-300">—</span> }
function EditPencil({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-qm-black hover:bg-qm-surface transition-colors">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
      </svg>
      Edit
    </button>
  )
}

function CardActions({
  editing, saved, pending,
  onEdit, onCancel, onSave,
}: {
  editing: boolean; saved: boolean; pending: boolean
  onEdit: () => void; onCancel: () => void; onSave: () => void
}) {
  return !editing ? (
    <div className="flex items-center gap-2">
      {saved && <span className="text-sm text-green-600 font-medium">Saved</span>}
      <EditPencil onClick={onEdit} />
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

export default function CustomerDetailClient({ customerId, orgId, orgSlug, initialData }: Props) {
  const [data, setData] = useState<CustomerData>(initialData)

  // Each card has its own editing state + saved flash
  const [detailEditing, setDetailEditing] = useState(false)
  const [detailDraft, setDetailDraft] = useState<CustomerData>(initialData)
  const [detailSaved, setDetailSaved] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailPending, startDetailTransition] = useTransition()

  const [addrEditing, setAddrEditing] = useState(false)
  const [addrDraft, setAddrDraft] = useState<CustomerData>(initialData)
  const [addrSaved, setAddrSaved] = useState(false)
  const [addrError, setAddrError] = useState<string | null>(null)
  const [addrPending, startAddrTransition] = useTransition()

  const [acctEditing, setAcctEditing] = useState(false)
  const [acctDraft, setAcctDraft] = useState<CustomerData>(initialData)
  const [acctSaved, setAcctSaved] = useState(false)
  const [acctError, setAcctError] = useState<string | null>(null)
  const [acctPending, startAcctTransition] = useTransition()

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

  // ── Customer Details save ──
  function saveDetail() {
    setDetailError(null)
    startDetailTransition(async () => {
      const res = await save({
        first_name: detailDraft.first_name,
        last_name: detailDraft.last_name,
        company_name: detailDraft.company_name,
        email: detailDraft.email,
        phone: detailDraft.phone,
        notes: detailDraft.notes,
        legal_name: detailDraft.legal_name,
        sales_rep: detailDraft.sales_rep,
        industry: detailDraft.industry,
        lead_source: detailDraft.lead_source,
        customer_group: detailDraft.customer_group,
        status: detailDraft.status,
        is_active: detailDraft.is_active,
      })
      if (res.error) { setDetailError(res.error); return }
      setData((d) => ({ ...d, ...detailDraft }))
      setDetailEditing(false)
      flash(setDetailSaved)
    })
  }

  // ── Address save ──
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

  // ── Account Info save ──
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
      })
      if (res.error) { setAcctError(res.error); return }
      setData((d) => ({ ...d, ...acctDraft }))
      setAcctEditing(false)
      flash(setAcctSaved)
    })
  }

  const primaryAddr = [data.street, data.street2, data.city, data.state, data.zip].some(Boolean)
  const secondaryAddr = [data.secondary_street, data.secondary_city, data.secondary_state, data.secondary_zip].some(Boolean)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── CUSTOMER DETAILS ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Customer Details</h2>
          <CardActions
            editing={detailEditing} saved={detailSaved} pending={detailPending}
            onEdit={() => { setDetailDraft({ ...data }); setDetailEditing(true); setDetailError(null) }}
            onCancel={() => { setDetailEditing(false); setDetailError(null) }}
            onSave={saveDetail}
          />
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
              <div><Label>Legal Name</Label>
                <input type="text" value={detailDraft.legal_name ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, legal_name: e.target.value || null })} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Email</Label>
                <input type="email" value={detailDraft.email ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, email: e.target.value || null })} className={ic} />
              </div>
              <div><Label>Phone</Label>
                <PhoneInput
                  value={detailDraft.phone ?? ''}
                  onChange={(val) => setDetailDraft({ ...detailDraft, phone: val.replace(/\D/g, '').length > 3 ? val : null })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Status</Label>
                <select value={detailDraft.status ?? 'lead'} onChange={(e) => setDetailDraft({ ...detailDraft, status: e.target.value })} className={sc}>
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div><Label>Sales Rep</Label>
                <input type="text" value={detailDraft.sales_rep ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, sales_rep: e.target.value || null })} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Industry</Label>
                <input type="text" value={detailDraft.industry ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, industry: e.target.value || null })} className={ic} />
              </div>
              <div><Label>Lead Source</Label>
                <input type="text" value={detailDraft.lead_source ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, lead_source: e.target.value || null })} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Customer Group</Label>
                <input type="text" value={detailDraft.customer_group ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, customer_group: e.target.value || null })} className={ic} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="checkbox" checked={detailDraft.is_active ?? true} onChange={(e) => setDetailDraft({ ...detailDraft, is_active: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
                  Active account
                </label>
              </div>
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
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Name</dt><dd className="font-medium mt-0.5">{data.first_name} {data.last_name}</dd></div>
            <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Company</dt><dd className="font-medium mt-0.5">{data.company_name ?? <Dash />}</dd></div>
            <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Email</dt><dd className="mt-0.5">{data.email ? <a href={`mailto:${data.email}`} className="text-qm-lime hover:underline">{data.email}</a> : <Dash />}</dd></div>
            <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Phone</dt><dd className="mt-0.5">{data.phone ? <a href={`tel:${data.phone}`} className="hover:underline">{data.phone}</a> : <Dash />}</dd></div>
            {data.legal_name && <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Legal Name</dt><dd className="font-medium mt-0.5">{data.legal_name}</dd></div>}
            {data.sales_rep && <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Sales Rep</dt><dd className="mt-0.5">{data.sales_rep}</dd></div>}
            {data.industry && <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Industry</dt><dd className="mt-0.5">{data.industry}</dd></div>}
            {data.lead_source && <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Lead Source</dt><dd className="mt-0.5">{data.lead_source}</dd></div>}
            {data.customer_group && <div><dt className="text-qm-gray text-xs uppercase tracking-wide">Customer Group</dt><dd className="mt-0.5">{data.customer_group}</dd></div>}
            {data.status && (
              <div>
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Status</dt>
                <dd className="mt-0.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
                    { lead: 'bg-gray-100 text-gray-700', sold: 'bg-qm-lime-light text-qm-lime-dark', closable: 'bg-blue-50 text-blue-700', prospect: 'bg-yellow-50 text-yellow-700' }[data.status] ?? 'bg-gray-100 text-gray-600'
                  }`}>{data.status}</span>
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
        )}
      </div>

      {/* ── ADDRESS CARD ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Address</h2>
          <CardActions
            editing={addrEditing} saved={addrSaved} pending={addrPending}
            onEdit={() => { setAddrDraft({ ...data }); setAddrEditing(true); setAddrError(null) }}
            onCancel={() => { setAddrEditing(false); setAddrError(null) }}
            onSave={saveAddr}
          />
        </div>
        {addrError && <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{addrError}</div>}

        {addrEditing ? (
          <div className="space-y-5">
            {/* Primary */}
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
            {/* Secondary */}
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-2">Ship To / Install Address</p>
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

      {/* ── ACCOUNT INFO CARD ── */}
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
              <div><Label>Pricing Level</Label>
                <input type="text" value={acctDraft.pricing_level ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, pricing_level: e.target.value || null })} className={ic} />
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
            <div><Label>Website</Label>
              <input type="url" value={acctDraft.website ?? ''} onChange={(e) => setAcctDraft({ ...acctDraft, website: e.target.value || null })} className={ic} placeholder="https://…" />
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
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Terms</dt>
              <dd className="font-medium mt-0.5">{data.terms ?? <Dash />}</dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Credit Limit</dt>
              <dd className="mt-0.5">{data.credit_limit != null ? `$${Number(data.credit_limit).toLocaleString()}` : <Dash />}</dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Tax</dt>
              <dd className="mt-0.5">
                {data.taxable ? 'Taxable' : 'Tax Exempt'}
                {data.tax_exempt_code && <span className="ml-1 text-qm-gray">({data.tax_exempt_code})</span>}
              </dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Discount %</dt>
              <dd className="mt-0.5">{data.discount_percent != null ? `${data.discount_percent}%` : <Dash />}</dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Pricing Level</dt>
              <dd className="mt-0.5">{data.pricing_level ?? <Dash />}</dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">CC Payments</dt>
              <dd className="mt-0.5">
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${data.allow_credit_card_payments !== false ? 'bg-qm-lime-light text-qm-lime-dark' : 'bg-gray-100 text-gray-600'}`}>
                  {data.allow_credit_card_payments !== false ? 'Yes' : 'No'}
                </span>
              </dd>
            </div>
            {data.website && (
              <div className="col-span-2">
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Website</dt>
                <dd className="mt-0.5"><a href={data.website} target="_blank" rel="noopener noreferrer" className="text-qm-lime hover:underline break-all">{data.website}</a></dd>
              </div>
            )}
            {data.tax_exempt_expires && (
              <div>
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Tax Exempt Expires</dt>
                <dd className="mt-0.5">{data.tax_exempt_expires}</dd>
              </div>
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
    </div>
  )
}
