'use client'

import { useState } from 'react'
import { upsertCarrierConnection, disconnectCarrierConnection } from './actions'

export type CarrierConnectionRow = {
  carrier: string
  is_connected: boolean
  credentials: Record<string, string>
  use_test_mode: boolean
}

type FieldDef = {
  key: string
  label: string
  type: 'text' | 'password'
  placeholder: string
  group: 'live' | 'test' | 'shared'
}

type CarrierDef = {
  key: string
  name: string
  initials: string
  color: string // tailwind bg-* class for the icon badge
  connectable: boolean
  hasTestMode: boolean
  fields: FieldDef[]
  note?: string
}

const CARRIERS: CarrierDef[] = [
  {
    key: 'easypost',
    name: 'EasyPost',
    initials: 'EP',
    color: 'bg-emerald-600',
    connectable: true,
    hasTestMode: true,
    fields: [
      { key: 'api_key', label: 'Live API Key', type: 'password', placeholder: 'Your EasyPost production key', group: 'live' },
      { key: 'test_api_key', label: 'Test API Key', type: 'password', placeholder: 'Your EasyPost test key', group: 'test' },
    ],
    note: 'Used for rate quoting, label purchase, and tracking across all carriers EasyPost supports.',
  },
  {
    key: 'fedex',
    name: 'FedEx',
    initials: 'Fx',
    color: 'bg-purple-700',
    connectable: true,
    hasTestMode: true,
    fields: [
      { key: 'client_id', label: 'Client ID (API Key)', type: 'text', placeholder: 'From developer.fedex.com', group: 'live' },
      { key: 'client_secret', label: 'Client Secret', type: 'password', placeholder: 'From developer.fedex.com', group: 'live' },
      { key: 'test_client_id', label: 'Test Client ID', type: 'text', placeholder: 'Sandbox project Client ID', group: 'test' },
      { key: 'test_client_secret', label: 'Test Client Secret', type: 'password', placeholder: 'Sandbox project Client Secret', group: 'test' },
      { key: 'account_number', label: 'FedEx Account Number', type: 'text', placeholder: 'Your FedEx account number', group: 'shared' },
    ],
    note: 'FedEx’s current REST API authenticates via OAuth Client ID/Secret (not the legacy Key + Meter Number scheme).',
  },
  { key: 'ups', name: 'UPS', initials: 'UPS', color: 'bg-amber-800', connectable: false, hasTestMode: false, fields: [] },
  { key: 'usps', name: 'USPS', initials: 'US', color: 'bg-blue-800', connectable: false, hasTestMode: false, fields: [] },
  { key: 'shipstation', name: 'ShipStation', initials: 'SS', color: 'bg-sky-600', connectable: false, hasTestMode: false, fields: [] },
]

type FormState = {
  credentials: Record<string, string>
  useTestMode: boolean
  connected: boolean
  expanded: boolean
  saving: boolean
  disconnecting: boolean
}

function initialFormState(row: CarrierConnectionRow | undefined): FormState {
  return {
    credentials: { ...(row?.credentials ?? {}) },
    useTestMode: row?.use_test_mode ?? false,
    connected: row?.is_connected ?? false,
    expanded: false,
    saving: false,
    disconnecting: false,
  }
}

type Props = {
  orgId: string
  orgSlug: string
  initialConnections: CarrierConnectionRow[]
}

export default function CarriersClient({ orgId, orgSlug, initialConnections }: Props) {
  const rowByCarrier = new Map(initialConnections.map((r) => [r.carrier, r]))

  const [state, setState] = useState<Record<string, FormState>>(() => {
    const m: Record<string, FormState> = {}
    for (const c of CARRIERS) m[c.key] = initialFormState(rowByCarrier.get(c.key))
    return m
  })
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function patch(key: string, p: Partial<FormState>) {
    setState((prev) => ({ ...prev, [key]: { ...prev[key], ...p } }))
  }

  function setField(carrierKey: string, fieldKey: string, value: string) {
    setState((prev) => ({
      ...prev,
      [carrierKey]: { ...prev[carrierKey], credentials: { ...prev[carrierKey].credentials, [fieldKey]: value } },
    }))
  }

  async function handleSave(carrier: CarrierDef) {
    const s = state[carrier.key]
    const missing = carrier.fields
      .filter((f) => f.group === 'shared' || f.group === (s.useTestMode ? 'test' : 'live'))
      .find((f) => !s.credentials[f.key]?.trim())
    if (missing) { showToast(`Error: ${missing.label} is required`); return }

    patch(carrier.key, { saving: true })
    const res = await upsertCarrierConnection(orgId, orgSlug, carrier.key, {
      credentials: s.credentials,
      use_test_mode: s.useTestMode,
      is_connected: true,
    })
    patch(carrier.key, { saving: false })
    if (res.error) { showToast(`Error: ${res.error}`); return }
    patch(carrier.key, { connected: true })
    showToast(`${carrier.name} connected`)
  }

  async function handleDisconnect(carrier: CarrierDef) {
    patch(carrier.key, { disconnecting: true })
    const res = await disconnectCarrierConnection(orgId, orgSlug, carrier.key)
    patch(carrier.key, { disconnecting: false })
    if (res.error) { showToast(`Error: ${res.error}`); return }
    patch(carrier.key, { connected: false, credentials: {} })
    showToast(`${carrier.name} disconnected`)
  }

  async function handleTestModeToggle(carrier: CarrierDef, val: boolean) {
    patch(carrier.key, { useTestMode: val })
    if (state[carrier.key].connected) {
      await upsertCarrierConnection(orgId, orgSlug, carrier.key, { use_test_mode: val })
    }
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast}
        </div>
      )}

      {CARRIERS.map((carrier) => {
        const s = state[carrier.key]
        const liveFields = carrier.fields.filter((f) => f.group === 'live')
        const testFields = carrier.fields.filter((f) => f.group === 'test')
        const sharedFields = carrier.fields.filter((f) => f.group === 'shared')

        if (!carrier.connectable) {
          return (
            <div
              key={carrier.key}
              className="flex items-center justify-between rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 px-5 py-4 opacity-60"
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${carrier.color} text-white font-bold text-xs shrink-0`}>
                  {carrier.initials}
                </div>
                <span className="text-sm font-semibold text-gray-500">{carrier.name}</span>
              </div>
              <span className="inline-flex items-center rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                Not Available
              </span>
            </div>
          )
        }

        return (
          <div key={carrier.key} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => patch(carrier.key, { expanded: !s.expanded })}
              className="flex w-full items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${carrier.color} text-white font-bold text-xs shrink-0`}>
                  {carrier.initials}
                </div>
                <div className="text-left">
                  <div className="text-sm font-semibold text-gray-800">{carrier.name}</div>
                  {carrier.note && <div className="text-xs text-gray-400">{carrier.note}</div>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${s.connected ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-gray-100 text-gray-500 ring-gray-200'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${s.connected ? 'bg-green-500' : 'bg-gray-400'}`} />
                  {s.connected ? 'Connected' : 'Not Connected'}
                </span>
                <svg className={`h-4 w-4 text-gray-400 transition-transform ${s.expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </div>
            </button>

            {s.expanded && (
              <div className="border-t border-gray-100 px-5 py-4 space-y-4">
                <div>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Live credentials</p>
                  <div className="space-y-3">
                    {liveFields.map((f) => (
                      <div key={f.key}>
                        <label className="mb-1 block text-xs font-medium text-gray-600">{f.label}</label>
                        <input
                          type={f.type}
                          value={s.credentials[f.key] ?? ''}
                          onChange={(e) => setField(carrier.key, f.key, e.target.value)}
                          placeholder={s.connected ? 'Re-enter to update' : f.placeholder}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {testFields.length > 0 && (
                  <div>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">Test credentials</p>
                    <div className="space-y-3">
                      {testFields.map((f) => (
                        <div key={f.key}>
                          <label className="mb-1 block text-xs font-medium text-gray-600">{f.label}</label>
                          <input
                            type={f.type}
                            value={s.credentials[f.key] ?? ''}
                            onChange={(e) => setField(carrier.key, f.key, e.target.value)}
                            placeholder={s.connected ? 'Re-enter to update' : f.placeholder}
                            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {sharedFields.length > 0 && (
                  <div className="space-y-3">
                    {sharedFields.map((f) => (
                      <div key={f.key}>
                        <label className="mb-1 block text-xs font-medium text-gray-600">{f.label}</label>
                        <input
                          type={f.type}
                          value={s.credentials[f.key] ?? ''}
                          onChange={(e) => setField(carrier.key, f.key, e.target.value)}
                          placeholder={s.connected ? 'Re-enter to update' : f.placeholder}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {carrier.hasTestMode && (
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="text-sm text-gray-700">Use Test Mode</span>
                      <p className="text-xs text-gray-400">Rate quotes and labels use the {carrier.name} sandbox — no real charges</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={s.useTestMode}
                      onClick={() => handleTestModeToggle(carrier, !s.useTestMode)}
                      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-1 ${s.useTestMode ? 'bg-amber-400' : 'bg-gray-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${s.useTestMode ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => handleSave(carrier)}
                    disabled={s.saving}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    {s.saving ? 'Saving…' : s.connected ? 'Save Changes' : 'Connect'}
                  </button>
                  {s.connected && (
                    <button
                      type="button"
                      onClick={() => handleDisconnect(carrier)}
                      disabled={s.disconnecting}
                      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      {s.disconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
