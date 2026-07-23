'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createPricingFormula,
  updatePricingFormula,
  deletePricingFormula,
  type PricingFormulaFormData,
} from './actions'

export type PricingFormula = {
  id: string
  organization_id: string | null
  name: string
  formula: string
  uom: string
  is_system: boolean
  description: string | null
  created_at: string
}

type Props = {
  orgId: string
  orgSlug: string
  initialFormulas: PricingFormula[]
  isOwnerOrAdmin: boolean
}

const UOM_OPTIONS = ['Sqft', 'Sq Yd', 'Sq In', 'Cu In', 'Inches', 'Feet', 'Yards', 'Board Ft', 'Clicks']

const inputCls =
  'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function emptyForm(): PricingFormulaFormData {
  return { name: '', formula: '', uom: '', description: '' }
}

function toForm(f: PricingFormula): PricingFormulaFormData {
  return {
    name: f.name,
    formula: f.formula,
    uom: f.uom,
    description: f.description ?? '',
  }
}

export default function PricingFormulasClient({
  orgId,
  orgSlug,
  initialFormulas,
  isOwnerOrAdmin,
}: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<PricingFormulaFormData>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function openNew() {
    setForm(emptyForm())
    setEditingId(null)
    setIsNew(true)
    setFormError(null)
  }

  function openEdit(f: PricingFormula) {
    setForm(toForm(f))
    setEditingId(f.id)
    setIsNew(false)
    setFormError(null)
  }

  function closeForm() {
    setEditingId(null)
    setIsNew(false)
    setFormError(null)
  }

  const isFormOpen = isNew || editingId !== null

  function handleSave() {
    setFormError(null)
    startTransition(async () => {
      if (isNew) {
        const result = await createPricingFormula(orgId, orgSlug, form)
        if (result.error) { setFormError(result.error); return }
        closeForm()
        showToast('Formula created')
        router.refresh()
      } else if (editingId) {
        const result = await updatePricingFormula(editingId, orgId, orgSlug, form)
        if (result.error) { setFormError(result.error); return }
        closeForm()
        showToast('Formula updated')
        router.refresh()
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePricingFormula(id, orgId, orgSlug)
      if (result.error) {
        showToast(`Error: ${result.error}`)
      } else {
        setConfirmDeleteId(null)
        showToast('Formula deleted')
        router.refresh()
      }
    })
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return initialFormulas
    return initialFormulas.filter((f) =>
      `${f.name} ${f.formula} ${f.uom} ${f.description ?? ''}`.toLowerCase().includes(term),
    )
  }, [initialFormulas, search])

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-qm-black">Pricing Formulas</h1>
          <p className="mt-1 text-sm text-gray-500">
            Formulas used to calculate quantity from product dimensions.
          </p>
        </div>
        {isOwnerOrAdmin && (
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Formula
          </button>
        )}
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search formulas..."
            className="block w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No formulas found</p>
          {search && <p className="mt-1 text-sm text-gray-500">Try a different search term.</p>}
          {!search && isOwnerOrAdmin && (
            <button
              onClick={openNew}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700"
            >
              New Formula
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Name
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Expression
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Unit
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Description
                </th>
                <th className="px-5 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50/60">
                  <td className="whitespace-nowrap px-5 py-3 text-sm font-semibold text-qm-black">
                    <div className="flex items-center gap-1.5">
                      {f.is_system && (
                        <span title="System formula — read only">
                          <svg
                            className="h-3.5 w-3.5 shrink-0 text-gray-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={2}
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                            />
                          </svg>
                        </span>
                      )}
                      {f.name}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-sm text-gray-800">
                      {f.formula}
                    </code>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {f.uom}
                    </span>
                  </td>
                  <td className="max-w-xs px-5 py-3 text-sm text-gray-500">
                    {f.description ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-right">
                    {f.is_system ? (
                      <span className="text-xs italic text-gray-400">System</span>
                    ) : isOwnerOrAdmin ? (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openEdit(f)}
                          className="text-sm font-medium text-qm-lime hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(f.id)}
                          className="text-sm font-medium text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 bg-gray-50 px-5 py-2 text-xs text-gray-400">
            {filtered.length} of {initialFormulas.length} formula
            {initialFormulas.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* New / Edit modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { if (!isPending) closeForm() }}
          />
          <div className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-bold text-qm-black">
                {isNew ? 'New Pricing Formula' : 'Edit Pricing Formula'}
              </h2>
              <button
                onClick={closeForm}
                disabled={isPending}
                className="rounded-md p-1 text-gray-400 hover:text-gray-700 disabled:opacity-50"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal body */}
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {formError && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <FormField label="Name" required>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. Area"
                  autoFocus
                />
              </FormField>

              <FormField label="Expression" required>
                <input
                  type="text"
                  value={form.formula}
                  onChange={(e) => setForm({ ...form, formula: e.target.value })}
                  className={`${inputCls} font-mono`}
                  placeholder="e.g. Width * Height"
                />
              </FormField>

              <FormField label="Result Unit" required>
                <input
                  type="text"
                  value={form.uom}
                  onChange={(e) => setForm({ ...form, uom: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. Sqft"
                  list="uom-options"
                />
                <datalist id="uom-options">
                  {UOM_OPTIONS.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </FormField>

              <FormField label="Description">
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputCls}
                  placeholder="What does this formula calculate?"
                />
              </FormField>
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button
                onClick={closeForm}
                disabled={isPending}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isPending}
                className="rounded-md bg-green-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                {isPending ? 'Saving…' : isNew ? 'Create Formula' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => { if (!isPending) setConfirmDeleteId(null) }}
          />
          <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-bold text-gray-900">Delete Formula?</h2>
            <p className="mb-5 text-sm text-gray-500">This cannot be undone.</p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={isPending}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={isPending}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
