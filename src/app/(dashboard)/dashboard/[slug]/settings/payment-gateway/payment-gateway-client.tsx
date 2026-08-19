'use client'

import { useState } from 'react'
import { upsertPaymentGateway, disconnectPaymentGateway } from './actions'

type GatewaySettings = {
  gateway_type: string
  hasApiLoginId: boolean
  hasTransactionKey: boolean
  hasClientKey: boolean
  use_test_mode: boolean
  is_connected: boolean
}

export type Props = {
  orgId: string
  orgSlug: string
  initialSettings: Partial<GatewaySettings>
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

export default function PaymentGatewayClient({ orgId, orgSlug, initialSettings }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // Inputs always start blank -- a saved credential is never sent to the browser, only
  // whether one exists (hasLoginId/hasTxKey), shown as a masked placeholder instead.
  const [loginId, setLoginId] = useState('')
  const [txKey, setTxKey] = useState('')
  const [clientKey, setClientKey] = useState('')
  const [hasLoginId, setHasLoginId] = useState(initialSettings.hasApiLoginId ?? false)
  const [hasTxKey, setHasTxKey] = useState(initialSettings.hasTransactionKey ?? false)
  const [hasClientKey, setHasClientKey] = useState(initialSettings.hasClientKey ?? false)
  const [testMode, setTestMode] = useState(initialSettings.use_test_mode ?? false)
  const [connected, setConnected] = useState(initialSettings.is_connected ?? false)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [errors, setErrors] = useState<{ loginId?: string; txKey?: string; clientKey?: string }>({})

  async function handleSave() {
    const errs: typeof errors = {}
    if (!loginId.trim() && !hasLoginId) errs.loginId = 'API Login ID is required'
    if (!txKey.trim() && !hasTxKey) errs.txKey = 'Transaction Key is required'
    if (!clientKey.trim() && !hasClientKey) errs.clientKey = 'Client Key is required for card payments (Account → Security Settings → Manage Public Client Key in Authorize.net)'
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setSaving(true)
    const res = await upsertPaymentGateway(orgId, orgSlug, {
      gateway_type: 'authorize_net',
      api_login_id: loginId.trim() || undefined,
      transaction_key: txKey.trim() || undefined,
      client_key: clientKey.trim() || undefined,
      use_test_mode: testMode,
      is_connected: true,
    })
    setSaving(false)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    if (loginId.trim()) setHasLoginId(true)
    if (txKey.trim()) setHasTxKey(true)
    if (clientKey.trim()) setHasClientKey(true)
    setLoginId('')
    setTxKey('')
    setClientKey('')
    setConnected(true)
    showToast('Saved')
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    const res = await disconnectPaymentGateway(orgId, orgSlug)
    setDisconnecting(false)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setLoginId('')
    setTxKey('')
    setClientKey('')
    setHasLoginId(false)
    setHasTxKey(false)
    setHasClientKey(false)
    setConnected(false)
    showToast('Disconnected')
  }

  async function handleTestModeToggle(val: boolean) {
    setTestMode(val)
    await upsertPaymentGateway(orgId, orgSlug, { use_test_mode: val })
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast}
        </div>
      )}

      {/* ── 1. GATEWAY SELECTOR ─────────────────────────────────────────── */}
      <SectionCard title="Payment Gateway">
        <div className="grid grid-cols-2 gap-4">
          {/* shopVOX Pay — unavailable */}
          <div className="relative rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-4 opacity-60">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-300 text-white font-bold text-xs shrink-0">sV</div>
              <span className="text-sm font-semibold text-gray-500">shopVOX Pay</span>
            </div>
            <span className="inline-flex items-center rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-500">
              Not Available
            </span>
          </div>

          {/* Authorize.net — selected */}
          <div className="relative rounded-xl border-2 border-qm-lime bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-700 text-white font-bold text-[10px] shrink-0">Auth</div>
                <span className="text-sm font-semibold text-gray-800">Authorize.net</span>
              </div>
              <svg className="h-5 w-5 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-xs text-gray-500">
              Credentials are encrypted at rest. Use the fields below to update.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* ── 2. AUTHORIZE.NET CONFIGURATION ──────────────────────────────── */}
      <SectionCard title="Authorize.net Configuration">
        {/* Status + info */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700 flex-1">
            Your Authorize.net credentials are stored securely. Test mode uses the sandbox endpoint{' '}
            <span className="font-mono">(apitest.authorize.net)</span>. Live mode uses{' '}
            <span className="font-mono">(api.authorize.net)</span>.
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${connected ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-gray-100 text-gray-500 ring-gray-200'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
            {connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>

        <div className="space-y-3">
          {/* API Login ID */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">API Login ID</label>
            <input
              type="text"
              value={loginId}
              onChange={(e) => { setLoginId(e.target.value); setErrors((p) => ({ ...p, loginId: undefined })) }}
              placeholder={hasLoginId ? '•••••••• (saved — leave blank to keep)' : 'Your API Login ID'}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 ${errors.loginId ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : 'border-gray-200 focus:border-qm-lime focus:ring-qm-lime'}`}
            />
            {errors.loginId && <p className="mt-1 text-xs text-red-600">{errors.loginId}</p>}
          </div>

          {/* Transaction Key */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Transaction Key</label>
            <input
              type="password"
              value={txKey}
              onChange={(e) => { setTxKey(e.target.value); setErrors((p) => ({ ...p, txKey: undefined })) }}
              placeholder={hasTxKey ? '•••••••• (saved — leave blank to keep)' : 'Your Transaction Key'}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 ${errors.txKey ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : 'border-gray-200 focus:border-qm-lime focus:ring-qm-lime'}`}
            />
            {errors.txKey && <p className="mt-1 text-xs text-red-600">{errors.txKey}</p>}
          </div>

          {/* Client Key */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Client Key</label>
            <input
              type="text"
              value={clientKey}
              onChange={(e) => { setClientKey(e.target.value); setErrors((p) => ({ ...p, clientKey: undefined })) }}
              placeholder={hasClientKey ? '•••••••• (saved — leave blank to keep)' : 'Your Public Client Key'}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 ${errors.clientKey ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : 'border-gray-200 focus:border-qm-lime focus:ring-qm-lime'}`}
            />
            <p className="mt-1 text-xs text-gray-400">
              Separate from the API Login ID / Transaction Key above — required for card entry on invoices and
              deposits (Authorize.net: Account → Security Settings → Manage Public Client Key).
            </p>
            {errors.clientKey && <p className="mt-1 text-xs text-red-600">{errors.clientKey}</p>}
          </div>

          {/* Test Mode toggle */}
          <div className="flex items-center justify-between py-1">
            <div>
              <span className="text-sm text-gray-700">Use Test Mode</span>
              <p className="text-xs text-gray-400">Transactions go to Authorize.net sandbox — no real charges</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={testMode}
              onClick={() => handleTestModeToggle(!testMode)}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-qm-lime focus:ring-offset-1 ${testMode ? 'bg-amber-400' : 'bg-gray-200'}`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${testMode ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
          {testMode && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Test mode is active — transactions will not charge real cards.
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>

          {connected && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </button>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
