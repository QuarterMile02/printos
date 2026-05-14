'use client'

import { useState, useTransition } from 'react'
import { updateVendor, type VendorUpdatePayload } from './actions'
import AddressAutocomplete from '@/components/ui/AddressAutocomplete'

type VendorData = {
  name: string
  legal_name: string | null
  primary_contact: string | null
  primary_email: string | null
  primary_phone: string | null
  website: string | null
  catalog_url: string | null
  account_id: string | null
  tax_id: string | null
  tax: string | null
  terms: string | null
  payment_method: string | null
  categories: string | null
  hours_of_operation: string | null
  background_info: string | null
  is_active: boolean | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  secondary_street: string | null
  secondary_city: string | null
  secondary_state: string | null
  secondary_zip: string | null
}

type Props = {
  vendorId: string
  orgId: string
  orgSlug: string
  initialData: VendorData
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

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
      <button onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-qm-black hover:bg-qm-surface transition-colors">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
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

export default function VendorDetailClient({ vendorId, orgId, orgSlug, initialData }: Props) {
  const [data, setData] = useState<VendorData>(initialData)

  const [detailEditing, setDetailEditing] = useState(false)
  const [detailDraft, setDetailDraft] = useState<VendorData>(initialData)
  const [detailSaved, setDetailSaved] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailPending, startDetailTransition] = useTransition()

  const [addrEditing, setAddrEditing] = useState(false)
  const [addrDraft, setAddrDraft] = useState<VendorData>(initialData)
  const [addrSaved, setAddrSaved] = useState(false)
  const [addrError, setAddrError] = useState<string | null>(null)
  const [addrPending, startAddrTransition] = useTransition()

  const [bizEditing, setBizEditing] = useState(false)
  const [bizDraft, setBizDraft] = useState<VendorData>(initialData)
  const [bizSaved, setBizSaved] = useState(false)
  const [bizError, setBizError] = useState<string | null>(null)
  const [bizPending, startBizTransition] = useTransition()

  function flash(setter: (v: boolean) => void) {
    setter(true)
    setTimeout(() => setter(false), 3000)
  }

  async function save(payload: VendorUpdatePayload): Promise<{ error?: string }> {
    return updateVendor(vendorId, orgId, orgSlug, payload)
  }

  function saveDetail() {
    setDetailError(null)
    startDetailTransition(async () => {
      const res = await save({
        name: detailDraft.name,
        legal_name: detailDraft.legal_name,
        primary_contact: detailDraft.primary_contact,
        primary_email: detailDraft.primary_email,
        primary_phone: detailDraft.primary_phone,
        website: detailDraft.website,
        is_active: detailDraft.is_active,
      })
      if (res.error) { setDetailError(res.error); return }
      setData((d) => ({ ...d, ...detailDraft }))
      setDetailEditing(false)
      flash(setDetailSaved)
    })
  }

  function saveAddr() {
    setAddrError(null)
    startAddrTransition(async () => {
      const res = await save({
        street: addrDraft.street,
        city: addrDraft.city,
        state: addrDraft.state,
        zip: addrDraft.zip,
        country: addrDraft.country,
        secondary_street: addrDraft.secondary_street,
        secondary_city: addrDraft.secondary_city,
        secondary_state: addrDraft.secondary_state,
        secondary_zip: addrDraft.secondary_zip,
      })
      if (res.error) { setAddrError(res.error); return }
      setData((d) => ({ ...d, ...addrDraft }))
      setAddrEditing(false)
      flash(setAddrSaved)
    })
  }

  function saveBiz() {
    setBizError(null)
    startBizTransition(async () => {
      const res = await save({
        account_id: bizDraft.account_id,
        tax_id: bizDraft.tax_id,
        tax: bizDraft.tax,
        terms: bizDraft.terms,
        payment_method: bizDraft.payment_method,
        catalog_url: bizDraft.catalog_url,
        categories: bizDraft.categories,
        hours_of_operation: bizDraft.hours_of_operation,
        background_info: bizDraft.background_info,
      })
      if (res.error) { setBizError(res.error); return }
      setData((d) => ({ ...d, ...bizDraft }))
      setBizEditing(false)
      flash(setBizSaved)
    })
  }

  const hasAddr = [data.street, data.city, data.state, data.zip].some(Boolean)
  const hasSecondaryAddr = [data.secondary_street, data.secondary_city, data.secondary_state, data.secondary_zip].some(Boolean)

  return (
    <div className="space-y-6">

      {/* ── VENDOR DETAILS ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Vendor Details</h2>
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
              <div>
                <Label required>Company Name</Label>
                <input type="text" value={detailDraft.name} onChange={(e) => setDetailDraft({ ...detailDraft, name: e.target.value })} className={ic} />
              </div>
              <div>
                <Label>Legal Name</Label>
                <input type="text" value={detailDraft.legal_name ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, legal_name: e.target.value || null })} className={ic} />
              </div>
            </div>
            <div>
              <Label>Primary Contact</Label>
              <input type="text" value={detailDraft.primary_contact ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, primary_contact: e.target.value || null })} className={ic} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Email</Label>
                <input type="email" value={detailDraft.primary_email ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, primary_email: e.target.value || null })} className={ic} />
              </div>
              <div>
                <Label>Phone</Label>
                <input type="text" value={detailDraft.primary_phone ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, primary_phone: e.target.value || null })} className={ic} />
              </div>
            </div>
            <div>
              <Label>Website</Label>
              <input type="url" value={detailDraft.website ?? ''} onChange={(e) => setDetailDraft({ ...detailDraft, website: e.target.value || null })} placeholder="https://…" className={ic} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_active" checked={detailDraft.is_active !== false} onChange={(e) => setDetailDraft({ ...detailDraft, is_active: e.target.checked })} className="h-4 w-4 rounded border-gray-300 accent-qm-lime" />
              <label htmlFor="is_active" className="text-sm text-gray-700 cursor-pointer">Active vendor</label>
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Company Name</dt>
              <dd className="font-medium mt-0.5">{data.name}</dd>
            </div>
            {data.legal_name && (
              <div>
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Legal Name</dt>
                <dd className="mt-0.5">{data.legal_name}</dd>
              </div>
            )}
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Primary Contact</dt>
              <dd className="mt-0.5">{data.primary_contact ?? <Dash />}</dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Email</dt>
              <dd className="mt-0.5">
                {data.primary_email
                  ? <a href={`mailto:${data.primary_email}`} className="text-qm-lime hover:underline">{data.primary_email}</a>
                  : <Dash />}
              </dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Phone</dt>
              <dd className="mt-0.5">
                {data.primary_phone
                  ? <a href={`tel:${data.primary_phone}`} className="text-qm-lime hover:underline">{data.primary_phone}</a>
                  : <Dash />}
              </dd>
            </div>
            {data.website && (
              <div>
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Website</dt>
                <dd className="mt-0.5">
                  <a href={data.website} target="_blank" rel="noopener noreferrer" className="text-qm-lime hover:underline break-all">{data.website}</a>
                </dd>
              </div>
            )}
          </dl>
        )}
      </div>

      {/* ── ADDRESS ── */}
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
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-2">Primary Address</p>
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
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1"><Label>City</Label><input type="text" value={addrDraft.city ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, city: e.target.value || null })} className={ic} /></div>
                  <div><Label>State</Label><input type="text" value={addrDraft.state ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, state: e.target.value || null })} className={ic} maxLength={2} placeholder="TX" /></div>
                  <div><Label>Zip</Label><input type="text" value={addrDraft.zip ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, zip: e.target.value || null })} className={ic} /></div>
                </div>
                <div><Label>Country</Label><input type="text" value={addrDraft.country ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, country: e.target.value || null })} className={ic} maxLength={2} placeholder="US" /></div>
              </div>
            </div>
            <div className="border-t border-gray-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-2">Secondary Address</p>
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
                    }))}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1"><Label>City</Label><input type="text" value={addrDraft.secondary_city ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, secondary_city: e.target.value || null })} className={ic} /></div>
                  <div><Label>State</Label><input type="text" value={addrDraft.secondary_state ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, secondary_state: e.target.value || null })} className={ic} maxLength={2} /></div>
                  <div><Label>Zip</Label><input type="text" value={addrDraft.secondary_zip ?? ''} onChange={(e) => setAddrDraft({ ...addrDraft, secondary_zip: e.target.value || null })} className={ic} /></div>
                </div>
              </div>
            </div>
          </div>
        ) : !hasAddr && !hasSecondaryAddr ? (
          <p className="text-sm text-qm-gray">No address on file</p>
        ) : (
          <div className="grid grid-cols-2 gap-6 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-1">Primary</p>
              {hasAddr ? (
                <address className="not-italic leading-relaxed text-qm-black">
                  {data.street && <div>{data.street}</div>}
                  {(data.city || data.state || data.zip) && (
                    <div>{[data.city, data.state, data.zip].filter(Boolean).join(', ')}</div>
                  )}
                  {data.country && data.country !== 'US' && <div>{data.country}</div>}
                </address>
              ) : <span className="text-qm-gray">—</span>}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-qm-gray mb-1">Secondary</p>
              {hasSecondaryAddr ? (
                <address className="not-italic leading-relaxed text-qm-black">
                  {data.secondary_street && <div>{data.secondary_street}</div>}
                  {(data.secondary_city || data.secondary_state || data.secondary_zip) && (
                    <div>{[data.secondary_city, data.secondary_state, data.secondary_zip].filter(Boolean).join(', ')}</div>
                  )}
                </address>
              ) : <span className="text-qm-gray">—</span>}
            </div>
          </div>
        )}
      </div>

      {/* ── BUSINESS INFO ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-qm-black">Business Info</h2>
          <CardActions
            editing={bizEditing} saved={bizSaved} pending={bizPending}
            onEdit={() => { setBizDraft({ ...data }); setBizEditing(true); setBizError(null) }}
            onCancel={() => { setBizEditing(false); setBizError(null) }}
            onSave={saveBiz}
          />
        </div>
        {bizError && <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{bizError}</div>}

        {bizEditing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Account Number</Label>
                <input type="text" value={bizDraft.account_id ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, account_id: e.target.value || null })} className={ic} />
              </div>
              <div>
                <Label>Payment Terms</Label>
                <input type="text" value={bizDraft.terms ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, terms: e.target.value || null })} className={ic} placeholder="Net 30" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Tax ID / EIN</Label>
                <input type="text" value={bizDraft.tax_id ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, tax_id: e.target.value || null })} className={ic} />
              </div>
              <div>
                <Label>Tax</Label>
                <input type="text" value={bizDraft.tax ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, tax: e.target.value || null })} className={ic} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Payment Method</Label>
                <input type="text" value={bizDraft.payment_method ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, payment_method: e.target.value || null })} className={ic} />
              </div>
              <div>
                <Label>Catalog URL</Label>
                <input type="url" value={bizDraft.catalog_url ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, catalog_url: e.target.value || null })} placeholder="https://…" className={ic} />
              </div>
            </div>
            <div>
              <Label>Categories</Label>
              <input type="text" value={bizDraft.categories ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, categories: e.target.value || null })} className={ic} placeholder="e.g. Vinyl, Paper, Hardware" />
            </div>
            <div>
              <Label>Hours of Operation</Label>
              <input type="text" value={bizDraft.hours_of_operation ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, hours_of_operation: e.target.value || null })} className={ic} placeholder="Mon–Fri 9am–5pm" />
            </div>
            <div>
              <Label>Notes / Background Info</Label>
              <textarea value={bizDraft.background_info ?? ''} onChange={(e) => setBizDraft({ ...bizDraft, background_info: e.target.value || null })} rows={3} className={ic} />
            </div>
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Account Number</dt>
              <dd className="font-medium mt-0.5">{data.account_id ?? <Dash />}</dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Payment Terms</dt>
              <dd className="mt-0.5">{data.terms ?? <Dash />}</dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Tax ID / EIN</dt>
              <dd className="mt-0.5">{data.tax_id ?? <Dash />}</dd>
            </div>
            <div>
              <dt className="text-qm-gray text-xs uppercase tracking-wide">Tax</dt>
              <dd className="mt-0.5">{data.tax ?? <Dash />}</dd>
            </div>
            {data.payment_method && (
              <div>
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Payment Method</dt>
                <dd className="mt-0.5">{data.payment_method}</dd>
              </div>
            )}
            {data.catalog_url && (
              <div>
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Catalog</dt>
                <dd className="mt-0.5">
                  <a href={data.catalog_url} target="_blank" rel="noopener noreferrer" className="text-qm-lime hover:underline break-all">{data.catalog_url}</a>
                </dd>
              </div>
            )}
            {data.categories && (
              <div className="col-span-2">
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Categories</dt>
                <dd className="mt-0.5">{data.categories}</dd>
              </div>
            )}
            {data.hours_of_operation && (
              <div className="col-span-2">
                <dt className="text-qm-gray text-xs uppercase tracking-wide">Hours</dt>
                <dd className="mt-0.5">{data.hours_of_operation}</dd>
              </div>
            )}
            {data.background_info && (
              <div className="col-span-2 border-t border-gray-100 pt-3 mt-1">
                <dt className="text-qm-gray text-xs uppercase tracking-wide mb-1">Notes</dt>
                <dd className="whitespace-pre-wrap">{data.background_info}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </div>
  )
}
