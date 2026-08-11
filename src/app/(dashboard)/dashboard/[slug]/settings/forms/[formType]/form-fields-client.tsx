'use client'

import { useState } from 'react'
import { updateFormFieldSettings, type FormFieldSettingRow } from '../actions'
import { SettingsPageHeader } from '@/components/settings/settings-page-header'

type Props = {
  orgId: string
  orgSlug: string
  formType: string
  formLabel: string
  initialFields: FormFieldSettingRow[]
}

export default function FormFieldsClient({ orgId, orgSlug, formType, formLabel, initialFields }: Props) {
  const [fields, setFields] = useState(initialFields)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function toggleVisible(fieldKey: string) {
    setFields((prev) => prev.map((f) => {
      if (f.field_key !== fieldKey) return f
      const is_visible = !f.is_visible
      // Required implies visible -- unchecking Visible also clears
      // Required, matching ShopVOX's own grayed-out-when-hidden behavior
      // (see the Customer/Material forms captured live: CSR, Do Not Call,
      // etc. all show Required disabled whenever Visible is off).
      return { ...f, is_visible, is_required: is_visible ? f.is_required : false }
    }))
    setDirty(true)
  }

  function toggleRequired(fieldKey: string) {
    setFields((prev) => prev.map((f) => (
      f.field_key === fieldKey && f.is_visible ? { ...f, is_required: !f.is_required } : f
    )))
    setDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    const result = await updateFormFieldSettings(
      orgId, orgSlug, formType,
      fields.map((f) => ({ field_key: f.field_key, is_visible: f.is_visible, is_required: f.is_required })),
    )
    setSaving(false)
    if (result.error) {
      showToast(`Error: ${result.error}`)
      return
    }
    setDirty(false)
    showToast('Saved')
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${toast.startsWith('Error') ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>
          {toast}
        </div>
      )}

      <SettingsPageHeader
        title={formLabel}
        description="Toggle the visibility and requiredness of fields on this form."
        primaryActionSlot={
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        }
      />

      {fields.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">Not configured yet</p>
          <p className="mt-1 text-sm text-gray-500">No fields have been set up for this form.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="w-28 px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Visible</th>
                <th className="w-28 px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Required</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fields.map((f) => (
                <tr key={f.field_key} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900">{f.field_label}</td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={f.is_visible}
                      onChange={() => toggleVisible(f.field_key)}
                      className="h-4 w-4 accent-qm-lime"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={f.is_required}
                      disabled={!f.is_visible}
                      onChange={() => toggleRequired(f.field_key)}
                      className="h-4 w-4 accent-qm-lime disabled:opacity-30"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
