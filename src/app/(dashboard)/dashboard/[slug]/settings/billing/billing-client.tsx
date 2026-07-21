'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
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

// NOTE: The 'org-logos' Supabase Storage bucket must be created manually in the
// Supabase dashboard (Storage → New bucket) with PUBLIC access enabled so that
// logo URLs are readable without authentication.
function LogoUpload({
  orgId,
  orgSlug,
  logoUrl,
  onLogoChange,
  showToast,
}: {
  orgId: string
  orgSlug: string
  logoUrl: string
  onLogoChange: (url: string) => void
  showToast: (msg: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      showToast('Error: Only image files are supported')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('Error: File must be 2 MB or smaller')
      return
    }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    const path = `${orgId}/logo.${ext}`
    setUploading(true)
    const { error: uploadError } = await supabase.storage
      .from('org-logos')
      .upload(path, file, { upsert: true })
    if (uploadError) {
      setUploading(false)
      showToast(`Error: ${uploadError.message}`)
      return
    }
    const { data: { publicUrl } } = supabase.storage.from('org-logos').getPublicUrl(path)
    const res = await upsertOrgProfile(orgId, orgSlug, { logo_url: publicUrl })
    setUploading(false)
    if (res.error) {
      showToast(`Error: ${res.error}`)
    } else {
      onLogoChange(publicUrl)
      showToast('Logo updated')
    }
  }

  async function handleRemove() {
    const res = await upsertOrgProfile(orgId, orgSlug, { logo_url: null })
    if (res.error) {
      showToast(`Error: ${res.error}`)
    } else {
      onLogoChange('')
      showToast('Logo removed')
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex items-start gap-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />

      {uploading ? (
        <div className="flex h-24 w-[120px] shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          <svg className="h-6 w-6 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : logoUrl ? (
        <div className="shrink-0 space-y-1.5">
          <img
            src={logoUrl}
            alt="Organization logo"
            style={{ maxWidth: 120 }}
            className="rounded-lg border border-gray-200 object-contain bg-white p-2"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="block text-xs text-red-500 hover:text-red-700"
          >
            Remove logo
          </button>
        </div>
      ) : (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex h-24 w-[120px] shrink-0 cursor-pointer select-none flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
            isDragOver
              ? 'border-qm-lime bg-lime-50'
              : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
          }`}
        >
          <svg className="mb-1 h-6 w-6 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="px-2 text-center text-[10px] leading-tight text-gray-500">
            Drop logo here<br />or click to browse
          </p>
        </div>
      )}

      <div className="flex-1 space-y-2">
        <p className="text-sm text-gray-600">
          Your logo appears on quotes, invoices, and other customer-facing PDFs.
        </p>
        <p className="text-xs text-gray-400">PNG, JPG, SVG, or WebP — max 2 MB.</p>
        {logoUrl && !uploading && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Replace logo
          </button>
        )}
      </div>
    </div>
  )
}

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

      {/* ── 1. LOGO ───────────────────────────────────────────────────────── */}
      <SectionCard title="Logo">
        <LogoUpload
          orgId={orgId}
          orgSlug={orgSlug}
          logoUrl={p.logo_url}
          onLogoChange={(url) => set('logo_url', url)}
          showToast={showToast}
        />
      </SectionCard>

      {/* ── 2. COMPANY INFORMATION ─────────────────────────────────────── */}
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
