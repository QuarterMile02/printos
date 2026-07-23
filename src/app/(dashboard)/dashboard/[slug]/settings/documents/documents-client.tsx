'use client'

import { useState } from 'react'
import VoiceInput from '@/components/voice-input'
import { upsertDocumentSettings, type DocumentSettingsInput } from './actions'

type DocType = 'quote' | 'sales_order' | 'invoice' | 'purchase_order'

export type DocumentSettingsRow = {
  organization_id: string
  document_type: string
  terms_and_conditions: string | null
  paper_size: string
  show_signature_line: boolean
  show_deposit_line: boolean
  show_pricing: boolean
  show_unit_price: boolean
  show_line_totals: boolean
  show_subtotal: boolean
  show_tax_line: boolean
  show_production_notes: boolean
  footer_note: string | null
}

type Settings = {
  show_signature_line: boolean
  show_deposit_line: boolean
  show_pricing: boolean
  show_unit_price: boolean
  show_line_totals: boolean
  show_subtotal: boolean
  show_tax_line: boolean
  show_production_notes: boolean
  paper_size: string
  terms_and_conditions: string
  footer_note: string
}

const DEFAULTS: Settings = {
  show_signature_line: true,
  show_deposit_line: true,
  show_pricing: true,
  show_unit_price: true,
  show_line_totals: true,
  show_subtotal: true,
  show_tax_line: true,
  show_production_notes: false,
  paper_size: 'letter',
  terms_and_conditions: '',
  footer_note: '',
}

function rowToSettings(row: DocumentSettingsRow | undefined): Settings {
  if (!row) return { ...DEFAULTS }
  return {
    show_signature_line: row.show_signature_line,
    show_deposit_line: row.show_deposit_line,
    show_pricing: row.show_pricing,
    show_unit_price: row.show_unit_price,
    show_line_totals: row.show_line_totals,
    show_subtotal: row.show_subtotal,
    show_tax_line: row.show_tax_line,
    show_production_notes: row.show_production_notes,
    paper_size: row.paper_size,
    terms_and_conditions: row.terms_and_conditions ?? '',
    footer_note: row.footer_note ?? '',
  }
}

type Props = {
  orgId: string
  orgSlug: string
  initialSettings: DocumentSettingsRow[]
}

const TABS: { key: DocType; label: string }[] = [
  { key: 'quote', label: 'Quote' },
  { key: 'sales_order', label: 'Sales Order' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'purchase_order', label: 'Purchase Order' },
]

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-1 ${
        value ? 'bg-qm-lime' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

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

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-b-0">
      <span className="text-sm text-gray-700">{label}</span>
      <Toggle value={value} onChange={onChange} />
    </div>
  )
}

export default function DocumentsClient({ orgId, orgSlug, initialSettings }: Props) {
  const [activeTab, setActiveTab] = useState<DocType>('quote')
  const [toast, setToast] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [allSettings, setAllSettings] = useState<Record<DocType, Settings>>(() => {
    const map: Record<DocType, Settings> = {
      quote: rowToSettings(undefined),
      sales_order: rowToSettings(undefined),
      invoice: rowToSettings(undefined),
      purchase_order: rowToSettings(undefined),
    }
    for (const row of initialSettings) {
      const key = row.document_type as DocType
      if (key === 'quote' || key === 'sales_order' || key === 'invoice' || key === 'purchase_order') {
        map[key] = rowToSettings(row)
      }
    }
    return map
  })

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function set<K extends keyof Settings>(tab: DocType, field: K, value: Settings[K]) {
    setAllSettings((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], [field]: value },
    }))
  }

  async function handleSave() {
    setSaving(true)
    const s = allSettings[activeTab]
    const input: DocumentSettingsInput = {
      show_signature_line: s.show_signature_line,
      show_deposit_line: s.show_deposit_line,
      show_pricing: s.show_pricing,
      show_unit_price: s.show_unit_price,
      show_line_totals: s.show_line_totals,
      show_subtotal: s.show_subtotal,
      show_tax_line: s.show_tax_line,
      show_production_notes: s.show_production_notes,
      paper_size: s.paper_size,
      terms_and_conditions: s.terms_and_conditions.trim() || null,
      footer_note: s.footer_note.trim() || null,
    }
    const res = await upsertDocumentSettings(orgId, orgSlug, activeTab, input)
    setSaving(false)
    const label =
      activeTab === 'quote' ? 'Quote'
      : activeTab === 'sales_order' ? 'Sales Order'
      : activeTab === 'invoice' ? 'Invoice'
      : 'Purchase Order'
    showToast(res.error ? `Error: ${res.error}` : `${label} settings saved`)
  }

  const s = allSettings[activeTab]

  const toggleRows: { key: keyof Settings; label: string }[] = [
    { key: 'show_signature_line', label: 'Show Signature Line' },
    ...(activeTab === 'quote'
      ? [{ key: 'show_deposit_line' as keyof Settings, label: 'Show Deposit Line' }]
      : []),
    { key: 'show_pricing', label: 'Show Pricing' },
    { key: 'show_unit_price', label: 'Show Unit Price' },
    { key: 'show_line_totals', label: 'Show Line Totals' },
    { key: 'show_subtotal', label: 'Show Subtotal' },
    { key: 'show_tax_line', label: 'Show Tax Line' },
    { key: 'show_production_notes', label: 'Show Production Notes' },
  ]

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
          }`}
        >
          {toast}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* PDF Options */}
      <SectionCard title="PDF Options">
        {toggleRows.map(({ key, label }) => (
          <ToggleRow
            key={key}
            label={label}
            value={s[key] as boolean}
            onChange={(v) => set(activeTab, key, v as Settings[typeof key])}
          />
        ))}
      </SectionCard>

      {/* Paper Size */}
      <SectionCard title="Paper Size">
        <div className="flex gap-6">
          {(['letter', 'legal', 'tabloid'] as const).map((size) => (
            <label key={size} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name={`paper_size_${activeTab}`}
                value={size}
                checked={s.paper_size === size}
                onChange={() => set(activeTab, 'paper_size', size)}
                className="accent-qm-lime"
              />
              <span className="text-sm text-gray-700 capitalize">{size}</span>
            </label>
          ))}
        </div>
      </SectionCard>

      {/* Terms & Conditions */}
      <SectionCard title="Terms & Conditions">
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Terms &amp; Conditions
        </label>
        <div className="relative">
          <textarea
            value={s.terms_and_conditions}
            onChange={(e) => set(activeTab, 'terms_and_conditions', e.target.value)}
            placeholder="Enter terms and conditions that will appear on this document type..."
            rows={6}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-10 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime resize-none"
          />
          <div className="absolute right-2 top-2">
            <VoiceInput
              onTranscript={(text) =>
                set(
                  activeTab,
                  'terms_and_conditions',
                  s.terms_and_conditions + (s.terms_and_conditions ? ' ' : '') + text,
                )
              }
            />
          </div>
        </div>
      </SectionCard>

      {/* Footer Note */}
      <SectionCard title="Footer Note">
        <label className="mb-1 block text-xs font-medium text-gray-600">Footer Note</label>
        <input
          type="text"
          value={s.footer_note}
          onChange={(e) => set(activeTab, 'footer_note', e.target.value)}
          placeholder="Optional note shown at the bottom of the PDF"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
      </SectionCard>

      {/* Save */}
      <div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
