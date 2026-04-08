'use client'

import { useState, useMemo, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { LaborRate, Discount, MachineRate } from '@/types/product-builder'
import {
  createLaborRate,
  updateLaborRate,
  toggleLaborRateActive,
  cloneFromMachineRate,
  type LaborRateFormData,
} from './actions'

type DiscountOption = Pick<Discount, 'id' | 'name' | 'discount_type' | 'applies_to' | 'discount_by' | 'active'>
type MachineRateOption = Pick<MachineRate, 'id' | 'name' | 'cost' | 'price' | 'markup' | 'units' | 'formula' | 'active'>
type UsedInProduct = { id: string; name: string }

type Props = {
  orgId: string
  orgSlug: string
  initialLaborRates: LaborRate[]
  discounts: DiscountOption[]
  machineRates: MachineRateOption[]
  usedInMap: Record<string, UsedInProduct[]>
}

type SortKey = 'name' | 'cost' | 'created_at'
type SortDir = 'asc' | 'desc'

const UNIT_OPTIONS = ['Hr', 'Min', 'Sqft', 'Feet', 'Inch', 'Unit', 'Each']
const FORMULA_OPTIONS = ['None', 'Unit', 'Area', 'Height', 'Width', 'Volume', 'Perimeter']
const PRODUCTION_UNIT_OPTIONS = ['Sqft', 'Feet', 'Units', 'Inches', 'Yards']
const PRODUCTION_PER_OPTIONS = ['Hour', 'Minute']
const QB_ITEM_TYPES = ['Inventory', 'Non-Inventory', 'Service']

function formatMoney(v: number | null | undefined): string {
  if (v == null) return '—'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function emptyForm(): LaborRateFormData {
  return {
    name: '',
    external_name: null,
    cost: 0,
    price: 0,
    markup: 1,
    setup_charge: null,
    machine_charge: null,
    other_charge: null,
    formula: null,
    units: null,
    include_in_base_price: false,
    per_li_unit: false,
    production_rate: null,
    production_rate_units: null,
    production_rate_per: null,
    production_factor: null,
    production_rate_prompt: null,
    production_rate_prompt_detail: null,
    volume_discount_id: null,
    cog_account: null,
    cog_account_number: null,
    qb_item_type: null,
    description: null,
    display_name_in_line_item: false,
    display_description_in_line_item: false,
    show_internal: false,
    sop_url: null,
    video_url: null,
    active: true,
  }
}

function toFormData(r: LaborRate): LaborRateFormData {
  return {
    name: r.name,
    external_name: r.external_name,
    cost: Number(r.cost),
    price: Number(r.price),
    markup: Number(r.markup),
    setup_charge: r.setup_charge,
    machine_charge: r.machine_charge,
    other_charge: r.other_charge,
    formula: r.formula,
    units: r.units,
    include_in_base_price: r.include_in_base_price ?? false,
    per_li_unit: r.per_li_unit ?? false,
    production_rate: r.production_rate,
    production_rate_units: r.production_rate_units,
    production_rate_per: r.production_rate_per,
    production_factor: r.production_factor,
    production_rate_prompt: r.production_rate_prompt,
    production_rate_prompt_detail: r.production_rate_prompt_detail,
    volume_discount_id: r.volume_discount_id,
    cog_account: r.cog_account,
    cog_account_number: r.cog_account_number,
    qb_item_type: r.qb_item_type,
    description: r.description,
    display_name_in_line_item: r.display_name_in_line_item ?? false,
    display_description_in_line_item: r.display_description_in_line_item ?? false,
    show_internal: r.show_internal ?? false,
    sop_url: r.sop_url,
    video_url: r.video_url,
    active: r.active ?? true,
  }
}

export default function LaborRatesClient({
  orgId,
  orgSlug,
  initialLaborRates,
  discounts,
  machineRates,
  usedInMap,
}: Props) {
  const router = useRouter()
  const [rates] = useState<LaborRate[]>(initialLaborRates)
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('active')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<LaborRateFormData>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)
  const [showClonePicker, setShowClonePicker] = useState(false)

  // Open an existing rate for editing
  function openEdit(rate: LaborRate) {
    setForm(toFormData(rate))
    setEditingId(rate.id)
    setIsNew(false)
    setFormError(null)
  }

  function openNew() {
    setForm(emptyForm())
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

  // Auto-calc triangle: when one of cost/price/markup changes, recompute the others
  function setCost(cost: number) {
    setForm((f) => ({ ...f, cost, price: Number((cost * f.markup).toFixed(2)) }))
  }
  function setPrice(price: number) {
    setForm((f) => ({
      ...f,
      price,
      markup: f.cost > 0 ? Number((price / f.cost).toFixed(4)) : f.markup,
    }))
  }
  function setMarkup(markup: number) {
    setForm((f) => ({ ...f, markup, price: Number((f.cost * markup).toFixed(2)) }))
  }

  const profitMargin = useMemo(() => {
    if (form.price <= 0) return null
    return ((form.price - form.cost) / form.price * 100).toFixed(2)
  }, [form.cost, form.price])

  // List filter/sort
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    let list = rates.filter((r) => {
      if (activeFilter === 'active' && !r.active) return false
      if (activeFilter === 'inactive' && r.active) return false
      if (term) {
        const hay = `${r.name} ${r.external_name ?? ''} ${r.formula ?? ''} ${r.units ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
    list = [...list].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'cost') cmp = Number(a.cost) - Number(b.cost)
      else if (sortKey === 'created_at') cmp = a.created_at.localeCompare(b.created_at)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return list
  }, [rates, search, activeFilter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  function handleSave() {
    setFormError(null)
    startTransition(async () => {
      if (isNew) {
        const result = await createLaborRate(orgId, orgSlug, form)
        if (result.error) {
          setFormError(result.error)
        } else {
          closeForm()
          showToast('Labor rate created')
          router.refresh()
        }
      } else if (editingId) {
        const result = await updateLaborRate(editingId, orgId, orgSlug, form)
        if (result.error) {
          setFormError(result.error)
        } else {
          closeForm()
          showToast('Labor rate updated')
          router.refresh()
        }
      }
    })
  }

  function handleToggleActive(id: string, nextActive: boolean) {
    startTransition(async () => {
      const result = await toggleLaborRateActive(id, orgId, orgSlug, nextActive)
      if (result.error) {
        showToast(`Error: ${result.error}`)
      } else {
        showToast(nextActive ? 'Activated' : 'Deactivated')
        router.refresh()
      }
    })
  }

  function handleCloneFromMachine(machineRateId: string) {
    startTransition(async () => {
      const result = await cloneFromMachineRate(machineRateId, orgId, orgSlug)
      if (result.error) {
        showToast(`Error: ${result.error}`)
      } else {
        setShowClonePicker(false)
        showToast('Cloned from machine rate — edit the new labor rate below')
        router.refresh()
      }
    })
  }

  // Warn on unsaved changes if user tries to close mid-edit
  useEffect(() => {
    if (!isFormOpen) return
    function beforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [isFormOpen])

  const usedInForEditing = editingId ? (usedInMap[editingId] ?? []) : []

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] rounded-lg border border-green-200 bg-green-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-medium text-green-800">{toast}</span>
        </div>
      )}

      {/* Header row */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-qm-black">Labor Rates</h1>
          <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2.5 py-0.5 text-xs font-semibold text-qm-lime-dark">
            {rates.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${orgSlug}/settings/labor-rates/import`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Import CSV
          </Link>
          <button
            onClick={() => setShowClonePicker(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
            Clone from Machine Rate
          </button>
          <button
            disabled
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-gray opacity-50 cursor-not-allowed"
            title="Coming in phase 7"
          >
            Import CSV
          </button>
          <button
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add New Labor Rate
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, external name, formula, units..."
            className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <select
          value={activeFilter}
          onChange={(e) => setActiveFilter(e.target.value as 'all' | 'active' | 'inactive')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="all">All</option>
        </select>
      </div>

      {/* Table */}
      {rates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No labor rates yet</p>
          <p className="mt-1 text-sm text-gray-500">Add your first labor rate or import from ShopVOX.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-qm-gray">No labor rates match your filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <SortHeader label="Name" active={sortKey === 'name'} dir={sortDir} onClick={() => toggleSort('name')} />
                <SortHeader label="Cost" active={sortKey === 'cost'} dir={sortDir} onClick={() => toggleSort('cost')} align="right" />
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Markup</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Units</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
                <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wide text-gray-500">Active</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-3">
                    <div className="text-sm font-semibold text-qm-black">{r.name}</div>
                    {r.external_name && <div className="text-xs text-qm-gray">{r.external_name}</div>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right text-sm text-qm-black">{formatMoney(r.cost)}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-right text-sm font-medium text-qm-black">{formatMoney(r.price)}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-right text-sm text-qm-gray">{Number(r.markup).toFixed(2)}×</td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{r.units ?? <span className="text-gray-300">—</span>}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{r.formula ?? <span className="text-gray-300">—</span>}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-center">
                    <button
                      onClick={() => handleToggleActive(r.id, !(r.active ?? true))}
                      disabled={isPending}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        r.active ? 'bg-qm-lime' : 'bg-gray-300'
                      } disabled:opacity-50`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${r.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right">
                    <button
                      onClick={() => openEdit(r)}
                      className="text-sm font-medium text-qm-lime hover:underline"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-2 text-xs text-qm-gray">
            Showing {filtered.length} of {rates.length} labor rates
          </div>
        </div>
      )}

      {/* Clone picker modal */}
      {showClonePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowClonePicker(false)} />
          <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl max-h-[80vh] flex flex-col">
            <h2 className="text-lg font-semibold text-qm-black mb-1">Clone from Machine Rate</h2>
            <p className="text-sm text-qm-gray mb-4">Pick a machine rate to copy into a new labor rate.</p>
            <div className="flex-1 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
              {machineRates.length === 0 ? (
                <p className="p-4 text-sm text-qm-gray text-center">No machine rates available</p>
              ) : (
                machineRates.map((mr) => (
                  <button
                    key={mr.id}
                    onClick={() => handleCloneFromMachine(mr.id)}
                    disabled={isPending}
                    className="w-full text-left px-4 py-3 hover:bg-qm-surface disabled:opacity-50 transition-colors"
                  >
                    <div className="text-sm font-semibold text-qm-black">{mr.name}</div>
                    <div className="text-xs text-qm-gray">
                      {formatMoney(mr.cost)} cost · {formatMoney(mr.price)} price · {mr.units ?? 'no units'}
                    </div>
                  </button>
                ))
              )}
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setShowClonePicker(false)} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Slide-over form */}
      {isFormOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => !isPending && closeForm()} />
          <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-bold text-qm-black">
                {isNew ? 'New Labor Rate' : 'Edit Labor Rate'}
              </h2>
              <button onClick={closeForm} disabled={isPending} className="rounded-md p-1 text-qm-gray hover:text-qm-black disabled:opacity-50">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
              {formError && (
                <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{formError}</div>
              )}

              {/* General Section */}
              <Section title="General">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Name" required>
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="External Name">
                    <input type="text" value={form.external_name ?? ''} onChange={(e) => setForm({ ...form, external_name: e.target.value || null })} className={inputClass} />
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Cost ($)">
                    <input type="number" step="0.01" value={form.cost} onChange={(e) => setCost(parseFloat(e.target.value) || 0)} className={inputClass} />
                  </Field>
                  <Field label="Markup (×)">
                    <input type="number" step="0.01" value={form.markup} onChange={(e) => setMarkup(parseFloat(e.target.value) || 0)} className={inputClass} />
                  </Field>
                  <Field label="Price ($)">
                    <input type="number" step="0.01" value={form.price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} className={inputClass} />
                  </Field>
                </div>
                <div className="rounded-lg bg-qm-lime-light px-4 py-2 text-sm">
                  <span className="text-qm-lime-dark font-semibold">Profit Margin:</span>{' '}
                  <span className="text-qm-black font-bold">{profitMargin ?? '—'}%</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Units">
                    <select value={form.units ?? ''} onChange={(e) => setForm({ ...form, units: e.target.value || null })} className={inputClass}>
                      <option value="">—</option>
                      {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Setup Charge">
                    <input type="number" step="0.01" value={form.setup_charge ?? ''} onChange={(e) => setForm({ ...form, setup_charge: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                  </Field>
                  <Field label="Machine Charge">
                    <input type="number" step="0.01" value={form.machine_charge ?? ''} onChange={(e) => setForm({ ...form, machine_charge: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                  </Field>
                  <Field label="Other Charge">
                    <input type="number" step="0.01" value={form.other_charge ?? ''} onChange={(e) => setForm({ ...form, other_charge: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                  </Field>
                </div>
              </Section>

              {/* Calculations Section */}
              <Section title="Calculations">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Formula">
                    <select value={form.formula ?? ''} onChange={(e) => setForm({ ...form, formula: e.target.value || null })} className={inputClass}>
                      <option value="">—</option>
                      {FORMULA_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </Field>
                  <Field label="Volume Discount">
                    <select value={form.volume_discount_id ?? ''} onChange={(e) => setForm({ ...form, volume_discount_id: e.target.value || null })} className={inputClass}>
                      <option value="">—</option>
                      {discounts.filter((d) => d.active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="flex items-center gap-6">
                  <Toggle label="Include in Base Price" checked={form.include_in_base_price} onChange={(v) => setForm({ ...form, include_in_base_price: v })} />
                  <Toggle label="Per LI Unit" checked={form.per_li_unit} onChange={(v) => setForm({ ...form, per_li_unit: v })} />
                </div>
              </Section>

              {/* Production Rate Section */}
              <Section title="Production Rate">
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Production Rate">
                    <input type="number" step="0.01" value={form.production_rate ?? ''} onChange={(e) => setForm({ ...form, production_rate: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                  </Field>
                  <Field label="Units">
                    <select value={form.production_rate_units ?? ''} onChange={(e) => setForm({ ...form, production_rate_units: e.target.value || null })} className={inputClass}>
                      <option value="">—</option>
                      {PRODUCTION_UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </Field>
                  <Field label="Per">
                    <select value={form.production_rate_per ?? ''} onChange={(e) => setForm({ ...form, production_rate_per: e.target.value || null })} className={inputClass}>
                      <option value="">—</option>
                      {PRODUCTION_PER_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Production Factor">
                  <input type="number" step="0.01" value={form.production_factor ?? ''} onChange={(e) => setForm({ ...form, production_factor: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                </Field>
                <Field label="Production Rate Prompt">
                  <input type="text" value={form.production_rate_prompt ?? ''} onChange={(e) => setForm({ ...form, production_rate_prompt: e.target.value || null })} className={inputClass} />
                </Field>
                <Field label="Production Rate Detail">
                  <input type="text" value={form.production_rate_prompt_detail ?? ''} onChange={(e) => setForm({ ...form, production_rate_prompt_detail: e.target.value || null })} className={inputClass} />
                </Field>
              </Section>

              {/* Accounting Section */}
              <Section title="Accounting">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="COG Account">
                    <input type="text" value={form.cog_account ?? ''} onChange={(e) => setForm({ ...form, cog_account: e.target.value || null })} className={inputClass} />
                  </Field>
                  <Field label="COG Account Number">
                    <input type="text" value={form.cog_account_number ?? ''} onChange={(e) => setForm({ ...form, cog_account_number: e.target.value || null })} className={inputClass} />
                  </Field>
                </div>
                <Field label="QB Item Type">
                  <select value={form.qb_item_type ?? ''} onChange={(e) => setForm({ ...form, qb_item_type: e.target.value || null })} className={inputClass}>
                    <option value="">—</option>
                    {QB_ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
              </Section>

              {/* Descriptions Section */}
              <Section title="Descriptions">
                <Field label="Description">
                  <textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value || null })} rows={3} className={inputClass} />
                </Field>
                <div className="space-y-2">
                  <Toggle label="Display Name in Line Item Description" checked={form.display_name_in_line_item} onChange={(v) => setForm({ ...form, display_name_in_line_item: v })} />
                  <Toggle label="Display Description in Line Item Description" checked={form.display_description_in_line_item} onChange={(v) => setForm({ ...form, display_description_in_line_item: v })} />
                  <Toggle label="Show Internal" checked={form.show_internal} onChange={(v) => setForm({ ...form, show_internal: v })} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="SOP URL">
                    <input type="url" value={form.sop_url ?? ''} onChange={(e) => setForm({ ...form, sop_url: e.target.value || null })} className={inputClass} />
                  </Field>
                  <Field label="Video URL">
                    <input type="url" value={form.video_url ?? ''} onChange={(e) => setForm({ ...form, video_url: e.target.value || null })} className={inputClass} />
                  </Field>
                </div>
              </Section>

              {/* Used In Section */}
              {!isNew && (
                <Section title="Used In">
                  {usedInForEditing.length === 0 ? (
                    <p className="text-sm text-qm-gray">Not currently used in any products.</p>
                  ) : (
                    <ul className="space-y-1">
                      {usedInForEditing.map((p) => (
                        <li key={p.id}>
                          <a href={`/dashboard/${orgSlug}/products`} className="text-sm text-qm-lime hover:underline">
                            {p.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {/* Active toggle */}
              <Section title="Status">
                <Toggle label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
              </Section>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
              <button onClick={closeForm} disabled={isPending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={isPending} className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {isPending ? 'Saving...' : isNew ? 'Create Labor Rate' : 'Save Changes'}
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  )
}

// ---- Helper components ----

const inputClass = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-qm-gray border-b border-gray-200 pb-1">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-qm-lime' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

function SortHeader({
  label, active, dir, onClick, align = 'left',
}: {
  label: string; active: boolean; dir: SortDir; onClick: () => void; align?: 'left' | 'right'
}) {
  return (
    <th className={`px-6 py-3 ${align === 'right' ? 'text-right' : 'text-left'} text-xs font-medium uppercase tracking-wide text-gray-500`}>
      <button onClick={onClick} className="inline-flex items-center gap-1 hover:text-qm-black transition-colors">
        {label}
        {active && (
          <span className="text-qm-lime">{dir === 'asc' ? '↑' : '↓'}</span>
        )}
      </button>
    </th>
  )
}
