'use client'

import { useState } from 'react'
import { upsertOrgProfile } from './actions'

type OrgProfile = {
  legal_name: string
  dba_name: string
  phone: string
  email: string
  website: string
  street: string
  city: string
  state: string
  zip: string
  country: string
  tax_id: string
  logo_url: string
  tagline: string
  footer_note: string
}

export type Props = {
  orgId: string
  orgSlug: string
  orgName: string
  initialProfile: Partial<OrgProfile>
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h2>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

export default function BillingClient({ orgId, orgSlug, orgName, initialProfile }: Props) {
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [p, setP] = useState<OrgProfile>({
    legal_name: initialProfile.legal_name ?? '',
    dba_name: initialProfile.dba_name ?? '',
    phone: initialProfile.phone ?? '',
    email: initialProfile.email ?? '',
    website: initialProfile.website ?? '',
    street: initialProfile.street ?? '',
    city: initialProfile.city ?? '',
    state: initialProfile.state ?? '',
    zip: initialProfile.zip ?? '',
    country: initialProfile.country ?? 'US',
    tax_id: initialProfile.tax_id ?? '',
    logo_url: initialProfile.logo_url ?? '',
    tagline: initialProfile.tagline ?? '',
    footer_note: initialProfile.footer_note ?? '',
  })

  function set(field: keyof OrgProfile, value: string) {
    setP((prev) => ({ ...prev, [field]: value }))
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function handleSave() {
    setSaving(true)
    const patch = Object.fromEntries(
      Object.entries(p).map(([k, v]) => [k, v.trim() || null]),
    ) as Partial<OrgProfile>
    const res = await upsertOrgProfile(orgId, orgSlug, patch)
    setSaving(false)
    showToast(res.error ? `Error: ${res.error}` : 'Saved')
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast}
        </div>
      )}

      {/* ── 1. COMPANY INFORMATION ─────────────────────────────────────── */}
      <SectionCard title="Company Information">
        {/* Two-column grid */}
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Legal Name">
            <input type="text" value={p.legal_name} onChange={(e) => set('legal_name', e.target.value)} placeholder="Quarter Mile Inc." className={inputCls} />
          </Field>
          <Field label="DBA / Trade Name">
            <input type="text" value={p.dba_name} onChange={(e) => set('dba_name', e.target.value)} placeholder="Quarter Mile Inc." className={inputCls} />
          </Field>
          <Field label="Phone">
            <input type="tel" value={p.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(956) 724-4000" className={inputCls} />
          </Field>
          <Field label="Email">
            <input type="email" value={p.email} onChange={(e) => set('email', e.target.value)} placeholder="info@quartermileinc.com" className={inputCls} />
          </Field>
          <Field label="Website">
            <input type="url" value={p.website} onChange={(e) => set('website', e.target.value)} placeholder="https://quartermileinc.com" className={inputCls} />
          </Field>
          <Field label="Tax ID (EIN)">
            <input type="text" value={p.tax_id} onChange={(e) => set('tax_id', e.target.value)} placeholder="XX-XXXXXXX" className={inputCls} />
          </Field>
        </div>

        {/* Address */}
        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Address</p>
          <Field label="Street">
            <input type="text" value={p.street} onChange={(e) => set('street', e.target.value)} placeholder="6420 Polaris Dr Ste 4" className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <input type="text" value={p.city} onChange={(e) => set('city', e.target.value)} placeholder="Laredo" className={inputCls} />
            </Field>
            <Field label="State">
              <select value={p.state} onChange={(e) => set('state', e.target.value)} className={inputCls}>
                <option value="">— Select —</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Zip">
              <input type="text" value={p.zip} onChange={(e) => set('zip', e.target.value)} placeholder="78041" className={inputCls} />
            </Field>
          </div>
          <Field label="Country">
            <select value={p.country} onChange={(e) => set('country', e.target.value)} className={inputCls}>
              <option value="US">United States</option>
              <option value="CA">Canada</option>
              <option value="MX">Mexico</option>
              <option value="GB">United Kingdom</option>
              <option value="AU">Australia</option>
            </select>
          </Field>
        </div>

        {/* PDF fields */}
        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Customer-Facing PDFs</p>
          <Field label="Tagline">
            <input type="text" value={p.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Your one-stop print shop" className={inputCls} />
          </Field>
          <Field label="Footer Note">
            <textarea
              value={p.footer_note}
              onChange={(e) => set('footer_note', e.target.value)}
              placeholder="Thank you for your business!"
              rows={3}
              className={`${inputCls} resize-none`}
            />
            <p className="mt-1 text-xs text-gray-400">Appears at the bottom of quotes, invoices, and other customer PDFs.</p>
          </Field>
        </div>

        <div className="mt-5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </SectionCard>

      {/* ── 2. LOGO ───────────────────────────────────────────────────────── */}
      <SectionCard title="Logo">
        <div className="flex items-start gap-6">
          {/* Preview */}
          <div className="shrink-0">
            {p.logo_url ? (
              <img
                src={p.logo_url}
                alt="Organization logo"
                className="h-20 w-40 rounded-lg border border-gray-200 object-contain bg-white p-2"
              />
            ) : (
              <div className="flex h-20 w-40 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
                <div className="text-center">
                  <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-gray-400 font-bold text-sm">
                    {orgName.charAt(0).toUpperCase()}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">No logo</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 space-y-3">
            <p className="text-sm text-gray-600">
              Your logo appears on quotes, invoices, and customer-facing PDFs.
            </p>
            <Field label="Logo URL">
              <input
                type="url"
                value={p.logo_url}
                onChange={(e) => set('logo_url', e.target.value)}
                placeholder="https://example.com/logo.png"
                className={inputCls}
              />
            </Field>
            <p className="text-xs text-gray-400">
              File upload coming in Phase 2. For now, paste a publicly accessible image URL.
            </p>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save Logo'}
            </button>
          </div>
        </div>
      </SectionCard>

      {/* ── 3. PLAN INFORMATION ───────────────────────────────────────────── */}
      <SectionCard title="Plan Information">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Plan</p>
              <p className="text-sm font-semibold text-gray-900">PrintOS Phase 1</p>
              <p className="text-xs text-gray-500">Internal Deployment</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Status</p>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <p className="text-sm font-semibold text-green-700">Active</p>
              </div>
            </div>
            <div className="rounded-lg bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Locations</p>
              <p className="text-sm font-semibold text-gray-900">1</p>
              <p className="text-xs text-gray-500">Quarter Mile Inc. — Laredo, TX</p>
            </div>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            Franchise expansion and multi-location billing will be configured during Phase 3 rollout.
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
