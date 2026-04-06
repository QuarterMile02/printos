'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Discount, DiscountTier, DiscountType, DiscountAppliesTo, DiscountBy } from '@/types/product-builder'
import { createDiscount, updateDiscount, toggleDiscountActive, type DiscountFormData, type TierRowInput } from './actions'

type Props = {
  orgId: string
  orgSlug: string
  initialDiscounts: Discount[]
  tiersByDiscount: Record<string, DiscountTier[]>
}

function emptyForm(): DiscountFormData {
  return {
    name: '',
    discount_type: 'Range',
    applies_to: 'Product',
    discount_by: 'Percentage',
    active: true,
  }
}

function toFormData(d: Discount): DiscountFormData {
  return {
    name: d.name,
    discount_type: d.discount_type,
    applies_to: d.applies_to,
    discount_by: d.discount_by,
    active: d.active ?? true,
  }
}

function emptyTier(): TierRowInput {
  return { min_qty: 0, max_qty: null, discount_percent: null, fixed_price: null }
}

function tierToInput(t: DiscountTier): TierRowInput {
  return {
    min_qty: Number(t.min_qty),
    max_qty: t.max_qty,
    discount_percent: t.discount_percent,
    fixed_price: t.fixed_price,
  }
}

export default function DiscountsClient({ orgId, orgSlug, initialDiscounts, tiersByDiscount }: Props) {
  const router = useRouter()
  const [discounts] = useState<Discount[]>(initialDiscounts)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<DiscountFormData>(emptyForm())
  const [tiers, setTiers] = useState<TierRowInput[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  function openEdit(d: Discount) {
    setForm(toFormData(d))
    setTiers((tiersByDiscount[d.id] ?? []).map(tierToInput))
    setEditingId(d.id)
    setIsNew(false)
    setFormError(null)
  }
  function openNew() {
    setForm(emptyForm())
    setTiers([emptyTier()])
    setEditingId(null)
    setIsNew(true)
    setFormError(null)
  }
  function closeForm() {
    setEditingId(null)
    setIsNew(false)
    setFormError(null)
  }
  const isFormOpen = isNew || editingId !== null

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }

  function handleSave() {
    setFormError(null)
    startTransition(async () => {
      if (isNew) {
        const result = await createDiscount(orgId, orgSlug, form, tiers)
        if (result.error) setFormError(result.error)
        else { closeForm(); showToast('Discount created'); router.refresh() }
      } else if (editingId) {
        const result = await updateDiscount(editingId, orgId, orgSlug, form, tiers)
        if (result.error) setFormError(result.error)
        else { closeForm(); showToast('Discount updated'); router.refresh() }
      }
    })
  }

  function handleToggleActive(id: string, nextActive: boolean) {
    startTransition(async () => {
      const result = await toggleDiscountActive(id, orgId, orgSlug, nextActive)
      if (result.error) showToast(`Error: ${result.error}`)
      else { showToast(nextActive ? 'Activated' : 'Deactivated'); router.refresh() }
    })
  }

  function addTier() {
    setTiers((ts) => [...ts, emptyTier()])
  }
  function updateTier(i: number, patch: Partial<TierRowInput>) {
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }
  function removeTier(i: number) {
    setTiers((ts) => ts.filter((_, idx) => idx !== i))
  }

  return (
    <>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-qm-black">Discounts</h1>
          <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2.5 py-0.5 text-xs font-semibold text-qm-lime-dark">
            {discounts.length}
          </span>
        </div>
        <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add New Discount
        </button>
      </div>

      {/* Table */}
      {discounts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No discounts yet</p>
          <p className="mt-1 text-sm text-gray-500">Add your first discount schedule.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Applies To</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Discount By</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Tiers</th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {discounts.map((d) => {
                const tierCount = (tiersByDiscount[d.id] ?? []).length
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-3 text-sm font-semibold text-qm-black">{d.name}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{d.discount_type}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{d.applies_to}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{d.discount_by}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-sm text-qm-black">{tierCount}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-center">
                      <button
                        onClick={() => handleToggleActive(d.id, !(d.active ?? true))}
                        disabled={isPending}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${d.active ? 'bg-qm-lime' : 'bg-gray-300'} disabled:opacity-50`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${d.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right">
                      <button onClick={() => openEdit(d)} className="text-sm font-medium text-qm-lime hover:underline">Edit</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal form */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !isPending && closeForm()} />
          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-bold text-qm-black">{isNew ? 'New Discount' : 'Edit Discount'}</h2>
              <button onClick={closeForm} disabled={isPending} className="rounded-md p-1 text-qm-gray hover:text-qm-black disabled:opacity-50">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {formError && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{formError}</div>
              )}

              <Field label="Name" required>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="e.g. Volume Tier A" />
              </Field>

              <Field label="Type">
                <div className="flex gap-4">
                  {(['Range', 'Volume', 'Price'] as DiscountType[]).map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" checked={form.discount_type === t} onChange={() => setForm({ ...form, discount_type: t })} className="accent-qm-lime" />
                      {t}
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Applies To">
                <div className="flex gap-4">
                  {(['Product', 'Material', 'Both'] as DiscountAppliesTo[]).map((a) => (
                    <label key={a} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" checked={form.applies_to === a} onChange={() => setForm({ ...form, applies_to: a })} className="accent-qm-lime" />
                      {a}
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="Discount By">
                <div className="flex gap-4">
                  {(['Percentage', 'Fixed Price'] as DiscountBy[]).map((b) => (
                    <label key={b} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" checked={form.discount_by === b} onChange={() => setForm({ ...form, discount_by: b })} className="accent-qm-lime" />
                      {b}
                    </label>
                  ))}
                </div>
              </Field>

              <Toggle label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />

              {/* Tiers table */}
              <div className="pt-2 border-t border-gray-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-qm-black">Breakpoints</h3>
                  <button
                    onClick={addTier}
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add New Breakpoint
                  </button>
                </div>

                {tiers.length === 0 ? (
                  <p className="text-sm text-qm-gray py-4 text-center">No breakpoints — click &quot;Add New Breakpoint&quot; to start.</p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Min Qty</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Max Qty</th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                            {form.discount_by === 'Percentage' ? 'Discount %' : 'Fixed Price ($)'}
                          </th>
                          <th className="px-3 py-2 w-12"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {tiers.map((t, i) => (
                          <tr key={i}>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                step="1"
                                value={t.min_qty}
                                onChange={(e) => updateTier(i, { min_qty: parseFloat(e.target.value) || 0 })}
                                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="number"
                                step="1"
                                value={t.max_qty ?? ''}
                                onChange={(e) => updateTier(i, { max_qty: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                placeholder="∞"
                                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                              />
                            </td>
                            <td className="px-3 py-2">
                              {form.discount_by === 'Percentage' ? (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={t.discount_percent ?? ''}
                                  onChange={(e) => updateTier(i, { discount_percent: e.target.value === '' ? null : parseFloat(e.target.value), fixed_price: null })}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                                />
                              ) : (
                                <input
                                  type="number"
                                  step="0.01"
                                  value={t.fixed_price ?? ''}
                                  onChange={(e) => updateTier(i, { fixed_price: e.target.value === '' ? null : parseFloat(e.target.value), discount_percent: null })}
                                  className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => removeTier(i)}
                                type="button"
                                className="rounded p-1 text-red-500 hover:bg-red-50"
                                title="Delete breakpoint"
                              >
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
              <button onClick={closeForm} disabled={isPending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={handleSave} disabled={isPending} className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {isPending ? 'Saving...' : isNew ? 'Create Discount' : 'Update Discount'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const inputClass = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button type="button" onClick={() => onChange(!checked)} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-qm-lime' : 'bg-gray-300'}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}
