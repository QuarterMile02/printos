'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createPricingFormula,
  updatePricingFormula,
  deletePricingFormula,
  setPricingFormulaLock,
  type PricingFormulaFormData,
} from './actions'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { applySortRules } from '@/components/data-table/use-saved-view'
import type { ColumnDef, SortRule, ViewMode } from '@/components/data-table/types'
import { PricingFormulaCard } from './pricing-formula-card'

export type PricingFormula = {
  id: string
  organization_id: string | null
  name: string
  formula: string
  uom: string
  is_system: boolean
  is_locked: boolean
  description: string | null
  created_at: string
}

type Props = {
  orgId: string
  orgSlug: string
  initialFormulas: PricingFormula[]
  isOwnerOrAdmin: boolean
  // TEMPORARY: edit/delete/lock are gated to isOwner directly because
  // there is no real Team Roles & Permissions system yet. Once one
  // exists, replace isOwner with a proper permission check throughout
  // this component and remove this comment.
  isOwner: boolean
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
  isOwner,
}: Props) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [originFilter, setOriginFilter] = useState<'all' | 'system' | 'custom'>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<PricingFormulaFormData>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [lockingId, setLockingId] = useState<string | null>(null)
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

  function handleToggleLock(f: PricingFormula) {
    setLockingId(f.id)
    startTransition(async () => {
      const result = await setPricingFormulaLock(f.id, orgId, orgSlug, !f.is_locked)
      if (result.error) {
        showToast(`Error: ${result.error}`)
      } else {
        showToast(f.is_locked ? 'Formula unlocked' : 'Formula locked')
        router.refresh()
      }
      setLockingId(null)
    })
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return initialFormulas.filter((f) => {
      if (originFilter === 'system' && !f.is_system) return false
      if (originFilter === 'custom' && f.is_system) return false
      if (!term) return true
      return `${f.name} ${f.formula} ${f.uom} ${f.description ?? ''}`.toLowerCase().includes(term)
    })
  }, [initialFormulas, search, originFilter])

  // ── Column resize + click-to-sort — same shared hooks/utilities used by
  // Materials, Discounts, etc. This list is small and entirely client-side,
  // so there's no saved-view persistence here, just local state.
  const COLUMNS = useMemo((): ColumnDef<PricingFormula>[] => [
    { key: 'name', label: 'Name', defaultWidth: 220, sortable: true, getValue: (f) => f.name },
    { key: 'formula', label: 'Expression', defaultWidth: 180, sortable: true, getValue: (f) => f.formula },
    { key: 'uom', label: 'Unit', defaultWidth: 110, sortable: true, getValue: (f) => f.uom },
    { key: 'description', label: 'Description', defaultWidth: 280, sortable: true, getValue: (f) => f.description },
    { key: 'actions', label: 'Actions', defaultWidth: 200, sortable: false },
  ], [])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  const [savedWidths, setSavedWidths] = useState<Record<string, number>>({})
  const { widths: colWidths, startResize } = useColumnResize({
    defaultWidths,
    savedWidths,
    onWidthCommit: (col, w) => setSavedWidths((prev) => ({ ...prev, [col]: w })),
  })

  const [sortRules, setSortRules] = useState<SortRule[]>([])
  function setSort(column: string) {
    setSortRules((prev) => {
      const existing = prev.find((r) => r.column === column)
      if (!existing) return [{ column, direction: 'asc' }]
      if (existing.direction === 'asc') return [{ column, direction: 'desc' }]
      return []
    })
  }

  const sorted = useMemo(() => applySortRules(filtered, sortRules, COLUMNS), [filtered, sortRules, COLUMNS])

  function SortIcon({ column }: { column: string }) {
    const rule = sortRules.find((r) => r.column === column)
    if (rule?.direction === 'asc') {
      return (
        <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75 12 8.25l7.5 7.5" />
        </svg>
      )
    }
    if (rule?.direction === 'desc') {
      return (
        <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      )
    }
    return (
      <svg className="h-3 w-3 opacity-20" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
      </svg>
    )
  }

  const totalWidth = COLUMNS.reduce((sum, c) => sum + (colWidths[c.key] ?? c.defaultWidth), 0)

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
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110"
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

      {/* Search + filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[240px]">
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
        <select
          value={originFilter}
          onChange={(e) => setOriginFilter(e.target.value as 'all' | 'system' | 'custom')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="all">All formulas</option>
          <option value="system">System only</option>
          <option value="custom">Custom only</option>
        </select>

        <div className="flex overflow-hidden rounded-md border border-gray-300">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            title="List view"
            className={`flex items-center px-2.5 py-2 transition-colors ${
              viewMode === 'list' ? 'bg-qm-lime-light text-qm-lime-dark' : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('card')}
            title="Card view"
            className={`flex items-center border-l border-gray-300 px-2.5 py-2 transition-colors ${
              viewMode === 'card' ? 'bg-qm-lime-light text-qm-lime-dark' : 'bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-700'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Card grid / Table */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No formulas found</p>
          {search && <p className="mt-1 text-sm text-gray-500">Try a different search term.</p>}
          {!search && isOwnerOrAdmin && (
            <button
              onClick={openNew}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110"
            >
              New Formula
            </button>
          )}
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {sorted.map((f) => (
            <PricingFormulaCard
              key={f.id}
              formula={f}
              editable={isOwner && !f.is_system && !f.is_locked}
              onClick={() => openEdit(f)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="divide-y divide-gray-200 table-fixed" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: colWidths[col.key] ?? col.defaultWidth }} />
              ))}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                {COLUMNS.map((col, i) => {
                  const isSortable = col.sortable
                  const isLast = i === COLUMNS.length - 1
                  const isActions = col.key === 'actions'
                  return (
                    <th
                      key={col.key}
                      onClick={isSortable ? () => setSort(col.key) : undefined}
                      className={`relative px-5 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${isSortable ? 'cursor-pointer hover:bg-gray-100' : ''} ${isActions ? `text-right ${STICKY_ACTIONS_TH}` : 'text-left'}`}
                    >
                      <div className={`flex items-center gap-1 ${isActions ? 'justify-end' : ''}`}>
                        {col.label}
                        {col.sortable && <SortIcon column={col.key} />}
                      </div>
                      {!isLast && (
                        <div
                          onMouseDown={(e) => startResize(col.key, e)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-qm-lime hover:opacity-30 z-10"
                        />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((f) => (
                <tr key={f.id} className="group hover:bg-gray-50/60">
                  <td className="overflow-hidden px-5 py-3 text-sm font-semibold text-qm-black">
                    <div className="flex items-center gap-1.5 truncate">
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
                      {!f.is_system && f.is_locked && (
                        <span title="Locked — read only">
                          <svg
                            className="h-3.5 w-3.5 shrink-0 text-amber-500"
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
                  <td className="overflow-hidden px-5 py-3">
                    <code className="inline-block max-w-full truncate rounded bg-gray-100 px-2 py-0.5 font-mono text-sm text-gray-800">
                      {f.formula}
                    </code>
                  </td>
                  <td className="overflow-hidden px-5 py-3">
                    <span className="inline-block max-w-full truncate rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {f.uom}
                    </span>
                  </td>
                  <td className="overflow-hidden px-5 py-3 text-sm text-gray-500">
                    <div className="truncate" title={f.description ?? undefined}>
                      {f.description ?? <span className="text-gray-300">—</span>}
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-5 py-3 text-right ${STICKY_ACTIONS_TD}`}>
                    {f.is_system ? (
                      <span className="text-xs italic text-gray-400">System</span>
                    ) : f.is_locked ? (
                      isOwner ? (
                        <div className="flex items-center justify-end gap-3">
                          <span className="text-xs italic text-gray-400">Locked</span>
                          <button
                            onClick={() => handleToggleLock(f)}
                            disabled={lockingId === f.id}
                            className="text-sm font-medium text-qm-lime hover:underline disabled:opacity-50"
                          >
                            {lockingId === f.id ? '…' : 'Unlock'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs italic text-gray-400">Locked</span>
                      )
                    ) : isOwner ? (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => openEdit(f)}
                          className="text-sm font-medium text-qm-lime hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleLock(f)}
                          disabled={lockingId === f.id}
                          className="text-sm font-medium text-gray-500 hover:underline disabled:opacity-50"
                        >
                          {lockingId === f.id ? '…' : 'Lock'}
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
                className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white transition-colors hover:brightness-110 disabled:opacity-50"
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
