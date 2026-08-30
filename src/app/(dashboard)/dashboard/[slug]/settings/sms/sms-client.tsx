'use client'

import { useState } from 'react'
import {
  upsertSmsSettings,
  disconnectSms,
  createSmsTemplate,
  updateSmsTemplate,
  deleteSmsTemplate,
} from './actions'

type SmsSettings = {
  hasTwilioAccountSid: boolean
  hasTwilioAuthToken: boolean
  twilio_phone_number: string | null
  country_code: string
  is_connected: boolean
}

type Template = {
  id: string
  name: string
  body: string
  sort_order: number
}

export type Props = {
  orgId: string
  orgSlug: string
  initialSettings: Partial<SmsSettings>
  initialTemplates: Template[]
}

const COUNTRIES = [
  { code: 'US', label: 'United States (+1)' },
  { code: 'CA', label: 'Canada (+1)' },
  { code: 'GB', label: 'United Kingdom (+44)' },
  { code: 'AU', label: 'Australia (+61)' },
  { code: 'MX', label: 'Mexico (+52)' },
]

const VARIABLES = [
  '{customer_name}', '{company_name}', '{quote_number}',
  '{so_number}', '{job_number}', '{rep_name}', '{amount}', '{link}',
]

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

export default function SmsClient({ orgId, orgSlug, initialSettings, initialTemplates }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  // ── Twilio Config ──────────────────────────────────────────────────────────
  // Inputs always start blank -- a saved credential is never sent to the browser, only
  // whether one exists (hasSid/hasToken), shown as a masked placeholder instead.
  const [sid, setSid] = useState('')
  const [token, setToken] = useState('')
  const [hasSid, setHasSid] = useState(initialSettings.hasTwilioAccountSid ?? false)
  const [hasToken, setHasToken] = useState(initialSettings.hasTwilioAuthToken ?? false)
  const [phone, setPhone] = useState(initialSettings.twilio_phone_number ?? '')
  const [country, setCountry] = useState(initialSettings.country_code ?? 'US')
  const [connected, setConnected] = useState(initialSettings.is_connected ?? false)
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  async function handleSave() {
    setSaving(true)
    const isNowConnected = !!((sid.trim() || hasSid) && (token.trim() || hasToken) && phone.trim())
    const res = await upsertSmsSettings(orgId, orgSlug, {
      twilio_account_sid: sid.trim() || undefined,
      twilio_auth_token: token.trim() || undefined,
      twilio_phone_number: phone.trim() || null,
      country_code: country,
      is_connected: isNowConnected,
    })
    setSaving(false)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    if (sid.trim()) setHasSid(true)
    if (token.trim()) setHasToken(true)
    setSid('')
    setToken('')
    setConnected(isNowConnected)
    showToast(isNowConnected ? 'Connected' : 'Saved')
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    const res = await disconnectSms(orgId, orgSlug)
    setDisconnecting(false)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setSid('')
    setToken('')
    setHasSid(false)
    setHasToken(false)
    setPhone('')
    setConnected(false)
    showToast('Disconnected')
  }

  // ── Templates ──────────────────────────────────────────────────────────────
  const [templates, setTemplates] = useState<Template[]>(initialTemplates)
  const [editId, setEditId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ name: string; body: string }>({ name: '', body: '' })
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState({ name: '', body: '' })
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function saveTemplate(id: string) {
    const res = await updateSmsTemplate(id, orgId, orgSlug, editDraft)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setTemplates((prev) => prev.map((t) => t.id === id ? { ...t, ...editDraft } : t))
    setEditId(null)
    showToast('Saved')
  }

  async function addTemplate() {
    if (!newDraft.name.trim() || !newDraft.body.trim()) return
    const res = await createSmsTemplate(orgId, orgSlug, { ...newDraft, sort_order: templates.length + 1 })
    if (res.error || !res.data) { showToast(`Error: ${res.error ?? 'No data returned'}`); return }
    setTemplates((prev) => [...prev, res.data as unknown as Template])
    setAdding(false)
    setNewDraft({ name: '', body: '' })
    showToast('Saved')
  }

  async function deleteTemplate(id: string) {
    const res = await deleteSmsTemplate(id, orgId, orgSlug)
    if (res.error) { showToast(`Error: ${res.error}`); return }
    setTemplates((prev) => prev.filter((t) => t.id !== id))
    setDeletingId(null)
    showToast('Deleted')
  }

  function TemplateFields({
    name, body, onNameChange, onBodyChange,
  }: { name: string; body: string; onNameChange: (v: string) => void; onBodyChange: (v: string) => void }) {
    return (
      <div className="space-y-2">
        <input
          type="text"
          placeholder="Template name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
        <textarea
          placeholder="Message body…"
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime resize-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {VARIABLES.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onBodyChange(body + v)}
              className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-600 hover:bg-gray-200 transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-gray-400">{body.length} chars — standard SMS is 160</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast}
        </div>
      )}

      {/* ── 1. TWILIO CONFIGURATION ────────────────────────────────────── */}
      <SectionCard title="Twilio Configuration">
        {/* Status + note */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <p className="text-sm text-gray-500">
            Using Twilio for automated system-level SMS. Dialpad handles individual rep communications.
          </p>
          <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${connected ? 'bg-green-50 text-green-700 ring-green-200' : 'bg-gray-100 text-gray-500 ring-gray-200'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400'}`} />
            {connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>

        <div className="space-y-3">
          {/* Account SID */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Account SID</label>
            <input
              type="text"
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              placeholder={hasSid ? '•••••••• (saved — leave blank to keep)' : 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>

          {/* Auth Token */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Auth Token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={hasToken ? '•••••••• (saved — leave blank to keep)' : 'Your Twilio auth token'}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>

          {/* Phone Number */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Phone Number</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+19562348791"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>

          {/* Country */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Country</label>
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Security note */}
        <p className="mt-3 text-xs text-gray-400">
          Credentials are stored securely and never exposed to the browser after saving.
        </p>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : connected ? 'Update' : 'Connect'}
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

      {/* ── 2. MESSAGE TEMPLATES ───────────────────────────────────────── */}
      <SectionCard title="Message Templates">
        <div className="space-y-2">
          {templates.map((t) =>
            editId === t.id ? (
              <div key={t.id} className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
                <TemplateFields
                  name={editDraft.name}
                  body={editDraft.body}
                  onNameChange={(v) => setEditDraft((d) => ({ ...d, name: v }))}
                  onBodyChange={(v) => setEditDraft((d) => ({ ...d, body: v }))}
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => saveTemplate(t.id)}
                    className="rounded px-3 py-1.5 text-xs font-medium bg-qm-lime text-gray-900 hover:opacity-90">
                    Save
                  </button>
                  <button type="button" onClick={() => setEditId(null)}
                    className="rounded px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div key={t.id} className="flex items-start gap-3 rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50/60 group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{t.name}</p>
                  <p className="mt-0.5 text-xs text-gray-400 truncate">
                    {t.body.length > 80 ? t.body.slice(0, 80) + '…' : t.body}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => { setEditId(t.id); setEditDraft({ name: t.name, body: t.body }) }}
                    title="Edit"
                    className="rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                    </svg>
                  </button>
                  {deletingId === t.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-red-600">Delete?</span>
                      <button type="button" onClick={() => deleteTemplate(t.id)} className="text-xs font-medium text-red-600 hover:underline">Yes</button>
                      <button type="button" onClick={() => setDeletingId(null)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeletingId(t.id)}
                      title="Delete"
                      className="rounded p-1 text-red-300 hover:text-red-600 hover:bg-red-50"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ),
          )}

          {/* Add new template */}
          {adding ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
              <TemplateFields
                name={newDraft.name}
                body={newDraft.body}
                onNameChange={(v) => setNewDraft((d) => ({ ...d, name: v }))}
                onBodyChange={(v) => setNewDraft((d) => ({ ...d, body: v }))}
              />
              <div className="flex gap-2">
                <button type="button" onClick={addTemplate}
                  className="rounded px-3 py-1.5 text-xs font-medium bg-qm-lime text-gray-900 hover:opacity-90">
                  Save
                </button>
                <button type="button" onClick={() => { setAdding(false); setNewDraft({ name: '', body: '' }) }}
                  className="rounded px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-1 flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 transition-colors"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add Message Template
            </button>
          )}
        </div>
      </SectionCard>
    </div>
  )
}
