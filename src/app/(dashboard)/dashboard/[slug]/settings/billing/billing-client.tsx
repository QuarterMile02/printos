'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { upsertOrgProfile, upsertBusinessHours } from './actions'

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
  timezone: string
  date_format: string
  currency: string
  units: string
}

export type DayHours = {
  day_of_week: number
  is_open: boolean
  open_time: string
  close_time: string
}

type AddressFields = {
  street: string
  city: string
  state: string
  zip: string
  country: string
}

export type Props = {
  orgId: string
  orgSlug: string
  orgName: string
  initialProfile: Partial<OrgProfile> & {
    billing_address?: unknown
    shipping_address?: unknown
  }
  initialHours: DayHours[]
}

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ORDER  = [1, 2, 3, 4, 5, 6, 0]

const DEFAULT_HOURS: DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
  day_of_week: d,
  is_open: d >= 1 && d <= 5,
  open_time: '08:00',
  close_time: '17:00',
}))

function parseAddr(raw: unknown): AddressFields {
  if (!raw || typeof raw !== 'object') return { street: '', city: '', state: '', zip: '', country: 'US' }
  const a = raw as Partial<AddressFields>
  return {
    street:  a.street  ?? '',
    city:    a.city    ?? '',
    state:   a.state   ?? '',
    zip:     a.zip     ?? '',
    country: a.country ?? 'US',
  }
}

// ── Shared UI primitives ──────────────────────────────────────────────────────

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

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        value ? 'bg-qm-lime' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function SaveButton({ saving, label = 'Save', onClick }: { saving: boolean; label?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
    >
      {saving ? 'Saving…' : label}
    </button>
  )
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

// ── Logo upload ───────────────────────────────────────────────────────────────

function LogoUpload({
  orgId, orgSlug, logoUrl, onLogoChange, showToast,
}: {
  orgId: string; orgSlug: string; logoUrl: string
  onLogoChange: (url: string) => void; showToast: (msg: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) { showToast('Error: Only image files are supported'); return }
    if (file.size > 2 * 1024 * 1024) { showToast('Error: File must be 2 MB or smaller'); return }
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
    setUploading(true)
    const { error: uploadError } = await supabase.storage
      .from('org-logos').upload(`${orgId}/logo.${ext}`, file, { upsert: true })
    if (uploadError) { setUploading(false); showToast(`Error: ${uploadError.message}`); return }
    const { data: { publicUrl } } = supabase.storage.from('org-logos').getPublicUrl(`${orgId}/logo.${ext}`)
    const res = await upsertOrgProfile(orgId, orgSlug, { logo_url: publicUrl })
    setUploading(false)
    if (res.error) showToast(`Error: ${res.error}`)
    else { onLogoChange(publicUrl); showToast('Logo updated') }
  }

  async function handleRemove() {
    const res = await upsertOrgProfile(orgId, orgSlug, { logo_url: null })
    if (res.error) showToast(`Error: ${res.error}`)
    else { onLogoChange(''); showToast('Logo removed') }
  }

  return (
    <div className="flex items-start gap-6">
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />

      {uploading ? (
        <div className="flex h-24 w-[120px] shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
          <svg className="h-6 w-6 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : logoUrl ? (
        <div className="shrink-0 space-y-1.5">
          <img src={logoUrl} alt="Organization logo" style={{ maxWidth: 120 }}
            className="rounded-lg border border-gray-200 object-contain bg-white p-2" />
          <button type="button" onClick={handleRemove} className="block text-xs text-red-500 hover:text-red-700">
            Remove logo
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false) }}
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex h-24 w-[120px] shrink-0 cursor-pointer select-none flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
            isDragOver ? 'border-qm-lime bg-lime-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
          }`}
        >
          <svg className="mb-1 h-6 w-6 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="px-2 text-center text-[10px] leading-tight text-gray-500">Drop logo here<br />or click to browse</p>
        </div>
      )}

      <div className="flex-1 space-y-2">
        <p className="text-sm text-gray-600">Your logo appears on quotes, invoices, and other customer-facing PDFs.</p>
        <p className="text-xs text-gray-400">PNG, JPG, SVG, or WebP — max 2 MB.</p>
        {logoUrl && !uploading && (
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-gray-200 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Replace logo
          </button>
        )}
      </div>
    </div>
  )
}

// ── Address sub-form ──────────────────────────────────────────────────────────

function AddressSubForm({
  heading, addr, onChange, onSameAsPrimary,
}: {
  heading: string
  addr: AddressFields
  onChange: (patch: Partial<AddressFields>) => void
  onSameAsPrimary: () => void
}) {
  function set(field: keyof AddressFields, value: string) {
    onChange({ [field]: value })
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{heading}</p>
        <button type="button" onClick={onSameAsPrimary}
          className="text-xs font-medium text-qm-lime hover:underline">
          Same as primary
        </button>
      </div>
      <Field label="Street">
        <input type="text" value={addr.street} onChange={(e) => set('street', e.target.value)} className={inputCls} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="City">
          <input type="text" value={addr.city} onChange={(e) => set('city', e.target.value)} className={inputCls} />
        </Field>
        <Field label="State">
          <select value={addr.state} onChange={(e) => set('state', e.target.value)} className={inputCls}>
            <option value="">— Select —</option>
            {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Zip">
          <input type="text" value={addr.zip} onChange={(e) => set('zip', e.target.value)} className={inputCls} />
        </Field>
      </div>
      <Field label="Country">
        <select value={addr.country} onChange={(e) => set('country', e.target.value)} className={inputCls}>
          <option value="US">United States</option>
          <option value="CA">Canada</option>
          <option value="MX">Mexico</option>
          <option value="GB">United Kingdom</option>
          <option value="AU">Australia</option>
        </select>
      </Field>
    </div>
  )
}

// ── Main client component ─────────────────────────────────────────────────────

export default function AccountClient({ orgId, orgSlug, orgName, initialProfile, initialHours }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  // ── Org profile state ──
  const [p, setP] = useState<OrgProfile>({
    legal_name:  initialProfile.legal_name  ?? '',
    dba_name:    initialProfile.dba_name    ?? '',
    phone:       initialProfile.phone       ?? '',
    email:       initialProfile.email       ?? '',
    website:     initialProfile.website     ?? '',
    street:      initialProfile.street      ?? '',
    city:        initialProfile.city        ?? '',
    state:       initialProfile.state       ?? '',
    zip:         initialProfile.zip         ?? '',
    country:     initialProfile.country     ?? 'US',
    tax_id:      initialProfile.tax_id      ?? '',
    logo_url:    initialProfile.logo_url    ?? '',
    tagline:     initialProfile.tagline     ?? '',
    footer_note: initialProfile.footer_note ?? '',
    timezone:    initialProfile.timezone    ?? 'America/Chicago',
    date_format: initialProfile.date_format ?? 'MM/DD/YYYY',
    currency:    initialProfile.currency    ?? 'USD',
    units:       initialProfile.units       ?? 'imperial',
  })

  // ── Business hours state ──
  const [hours, setHours] = useState<DayHours[]>(
    initialHours.length === 7 ? initialHours : DEFAULT_HOURS,
  )

  // ── Address state ──
  const [billingAddr,  setBillingAddr]  = useState<AddressFields>(parseAddr(initialProfile.billing_address))
  const [shippingAddr, setShippingAddr] = useState<AddressFields>(parseAddr(initialProfile.shipping_address))

  // ── Save states ──
  const [saving,          setSaving]          = useState(false)
  const [savingRegional,  setSavingRegional]  = useState(false)
  const [savingHours,     setSavingHours]     = useState(false)
  const [savingAddresses, setSavingAddresses] = useState(false)

  function set(field: keyof OrgProfile, value: string) {
    setP((prev) => ({ ...prev, [field]: value }))
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function updateHour(day: number, field: keyof DayHours, value: boolean | string) {
    setHours((prev) => prev.map((h) => h.day_of_week === day ? { ...h, [field]: value } : h))
  }

  function applyWeekdayHoursToWeekend() {
    const mon = hours.find((h) => h.day_of_week === 1) ?? { open_time: '08:00', close_time: '17:00' }
    setHours((prev) =>
      prev.map((h) =>
        h.day_of_week === 0 || h.day_of_week === 6
          ? { ...h, is_open: true, open_time: mon.open_time, close_time: mon.close_time }
          : h,
      ),
    )
  }

  function primaryAddr(): AddressFields {
    return { street: p.street, city: p.city, state: p.state, zip: p.zip, country: p.country || 'US' }
  }

  // ── Save handlers ──

  async function handleSave() {
    setSaving(true)
    const res = await upsertOrgProfile(orgId, orgSlug, {
      legal_name:  p.legal_name.trim()  || null,
      dba_name:    p.dba_name.trim()    || null,
      phone:       p.phone.trim()       || null,
      email:       p.email.trim()       || null,
      website:     p.website.trim()     || null,
      street:      p.street.trim()      || null,
      city:        p.city.trim()        || null,
      state:       p.state.trim()       || null,
      zip:         p.zip.trim()         || null,
      country:     p.country.trim()     || null,
      tax_id:      p.tax_id.trim()      || null,
      tagline:     p.tagline.trim()     || null,
      footer_note: p.footer_note.trim() || null,
    })
    setSaving(false)
    showToast(res.error ? `Error: ${res.error}` : 'Saved')
  }

  async function handleSaveRegional() {
    setSavingRegional(true)
    const res = await upsertOrgProfile(orgId, orgSlug, {
      timezone:    p.timezone    || 'America/Chicago',
      date_format: p.date_format || 'MM/DD/YYYY',
      currency:    p.currency    || 'USD',
      units:       p.units       || 'imperial',
    })
    setSavingRegional(false)
    showToast(res.error ? `Error: ${res.error}` : 'Regional preferences saved')
  }

  async function handleSaveHours() {
    setSavingHours(true)
    const res = await upsertBusinessHours(orgId, orgSlug, hours)
    setSavingHours(false)
    showToast(res.error ? `Error: ${res.error}` : 'Business hours saved')
  }

  async function handleSaveAddresses() {
    setSavingAddresses(true)
    const res = await upsertOrgProfile(orgId, orgSlug, {
      billing_address:  billingAddr.street  ? billingAddr  : null,
      shipping_address: shippingAddr.street ? shippingAddr : null,
    })
    setSavingAddresses(false)
    showToast(res.error ? `Error: ${res.error}` : 'Addresses saved')
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
          toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
        }`}>
          {toast}
        </div>
      )}

      {/* ── 1. LOGO ─────────────────────────────────────────────────────────── */}
      <SectionCard title="Logo">
        <LogoUpload
          orgId={orgId} orgSlug={orgSlug} logoUrl={p.logo_url}
          onLogoChange={(url) => set('logo_url', url)} showToast={showToast}
        />
      </SectionCard>

      {/* ── 2. COMPANY INFORMATION ──────────────────────────────────────────── */}
      <SectionCard title="Company Information">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Legal Name">
            <input type="text" value={p.legal_name} onChange={(e) => set('legal_name', e.target.value)}
              placeholder="Quarter Mile Inc." className={inputCls} />
          </Field>
          <Field label="DBA / Trade Name">
            <input type="text" value={p.dba_name} onChange={(e) => set('dba_name', e.target.value)}
              placeholder="Quarter Mile Inc." className={inputCls} />
          </Field>
          <Field label="Phone">
            <input type="tel" value={p.phone} onChange={(e) => set('phone', e.target.value)}
              placeholder="(956) 724-4000" className={inputCls} />
          </Field>
          <Field label="Email">
            <input type="email" value={p.email} onChange={(e) => set('email', e.target.value)}
              placeholder="info@quartermileinc.com" className={inputCls} />
          </Field>
          <Field label="Website">
            <input type="url" value={p.website} onChange={(e) => set('website', e.target.value)}
              placeholder="https://quartermileinc.com" className={inputCls} />
          </Field>
          <Field label="Tax ID (EIN)">
            <input type="text" value={p.tax_id} onChange={(e) => set('tax_id', e.target.value)}
              placeholder="XX-XXXXXXX" className={inputCls} />
          </Field>
        </div>

        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Primary Address</p>
          <Field label="Street">
            <input type="text" value={p.street} onChange={(e) => set('street', e.target.value)}
              placeholder="6420 Polaris Dr Ste 4" className={inputCls} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City">
              <input type="text" value={p.city} onChange={(e) => set('city', e.target.value)}
                placeholder="Laredo" className={inputCls} />
            </Field>
            <Field label="State">
              <select value={p.state} onChange={(e) => set('state', e.target.value)} className={inputCls}>
                <option value="">— Select —</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Zip">
              <input type="text" value={p.zip} onChange={(e) => set('zip', e.target.value)}
                placeholder="78041" className={inputCls} />
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

        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Customer-Facing PDFs</p>
          <Field label="Tagline">
            <input type="text" value={p.tagline} onChange={(e) => set('tagline', e.target.value)}
              placeholder="Your one-stop print shop" className={inputCls} />
          </Field>
          <Field label="Footer Note">
            <textarea value={p.footer_note} onChange={(e) => set('footer_note', e.target.value)}
              placeholder="Thank you for your business!" rows={3}
              className={`${inputCls} resize-none`} />
            <p className="mt-1 text-xs text-gray-400">Appears at the bottom of quotes, invoices, and other customer PDFs.</p>
          </Field>
        </div>

        <div className="mt-5">
          <SaveButton saving={saving} label="Save Changes" onClick={handleSave} />
        </div>
      </SectionCard>

      {/* ── 3. REGIONAL PREFERENCES ─────────────────────────────────────────── */}
      <SectionCard title="Regional Preferences">
        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="Timezone">
            <select value={p.timezone} onChange={(e) => set('timezone', e.target.value)} className={inputCls}>
              <option value="America/Chicago">Central Time (America/Chicago)</option>
              <option value="America/New_York">Eastern Time (America/New_York)</option>
              <option value="America/Denver">Mountain Time (America/Denver)</option>
              <option value="America/Los_Angeles">Pacific Time (America/Los_Angeles)</option>
              <option value="America/Phoenix">Arizona — no DST (America/Phoenix)</option>
              <option value="America/Anchorage">Alaska Time (America/Anchorage)</option>
              <option value="Pacific/Honolulu">Hawaii Time (Pacific/Honolulu)</option>
              <option value="UTC">UTC</option>
            </select>
          </Field>
          <Field label="Date Format">
            <select value={p.date_format} onChange={(e) => set('date_format', e.target.value)} className={inputCls}>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </Field>
          <Field label="Currency">
            <select value={p.currency} onChange={(e) => set('currency', e.target.value)} className={inputCls}>
              <option value="USD">USD — US Dollar</option>
              <option value="MXN">MXN — Mexican Peso</option>
              <option value="CAD">CAD — Canadian Dollar</option>
              <option value="EUR">EUR — Euro</option>
            </select>
          </Field>
          <Field label="Units">
            <select value={p.units} onChange={(e) => set('units', e.target.value)} className={inputCls}>
              <option value="imperial">Imperial (in, ft, lbs)</option>
              <option value="metric">Metric (cm, m, kg)</option>
            </select>
          </Field>
        </div>
        <div className="mt-5">
          <SaveButton saving={savingRegional} onClick={handleSaveRegional} />
        </div>
      </SectionCard>

      {/* ── 4. BUSINESS HOURS ───────────────────────────────────────────────── */}
      <SectionCard title="Business Hours">
        <div className="divide-y divide-gray-50">
          {DAY_ORDER.map((dayIndex) => {
            const h = hours.find((row) => row.day_of_week === dayIndex) ?? DEFAULT_HOURS[dayIndex]
            return (
              <div key={dayIndex} className="flex items-center gap-4 py-2.5">
                <span className="w-24 shrink-0 text-sm font-medium text-gray-700">
                  {DAY_LABELS[dayIndex]}
                </span>
                <Toggle value={h.is_open} onChange={(v) => updateHour(dayIndex, 'is_open', v)} />
                {h.is_open ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={h.open_time}
                      onChange={(e) => updateHour(dayIndex, 'open_time', e.target.value)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none"
                    />
                    <span className="text-sm text-gray-400">to</span>
                    <input
                      type="time"
                      value={h.close_time}
                      onChange={(e) => updateHour(dayIndex, 'close_time', e.target.value)}
                      className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none"
                    />
                  </div>
                ) : (
                  <span className="text-sm italic text-gray-400">Closed</span>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={applyWeekdayHoursToWeekend}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Same as weekdays
          </button>
          <SaveButton saving={savingHours} onClick={handleSaveHours} />
        </div>
      </SectionCard>

      {/* ── 5. LOCATIONS / ADDRESSES ────────────────────────────────────────── */}
      <SectionCard title="Locations / Addresses">
        {/* Primary — read-only, already managed in Company Information */}
        <div className="mb-6 rounded-lg bg-gray-50 px-4 py-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Primary Address</p>
          {p.street ? (
            <p className="text-sm text-gray-700">
              {p.street}{p.city || p.state || p.zip ? `, ${[p.city, p.state, p.zip].filter(Boolean).join(' ')}` : ''}
            </p>
          ) : (
            <p className="text-sm italic text-gray-400">Not set — add it in Company Information above.</p>
          )}
        </div>

        <div className="space-y-6">
          <AddressSubForm
            heading="Billing Address"
            addr={billingAddr}
            onChange={(patch) => setBillingAddr((prev) => ({ ...prev, ...patch }))}
            onSameAsPrimary={() => setBillingAddr(primaryAddr())}
          />
          <AddressSubForm
            heading="Shipping / Pickup Address"
            addr={shippingAddr}
            onChange={(patch) => setShippingAddr((prev) => ({ ...prev, ...patch }))}
            onSameAsPrimary={() => setShippingAddr(primaryAddr())}
          />
        </div>

        <div className="mt-5">
          <SaveButton saving={savingAddresses} onClick={handleSaveAddresses} />
        </div>
      </SectionCard>

      {/* ── 6. PLAN INFORMATION ─────────────────────────────────────────────── */}
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
