'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Modifier, ModifierType } from '@/types/product-builder'
import { createModifier, updateModifier, toggleModifierActive, type ModifierFormData } from './actions'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'
import type { ColumnDef } from '@/components/data-table/types'
import { useSavedView, applyFilterRules, applySortRules } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { ModifierCard } from './modifier-card'

type Props = {
  orgId: string
  orgSlug: string
  userId: string
  userRole: string
  initialModifiers: Modifier[]
}

const DEFAULT_SORT = [{ column: 'display_name', direction: 'asc' as const }]

const UNIT_OPTIONS = ['Feet', 'Inches', 'Sqft', 'Unit', 'Miles', 'Yard', '%', 'Pounds', 'Ounces', 'Hours']
const TYPE_BADGE: Record<ModifierType, string> = {
  Boolean: 'bg-qm-lime-light text-qm-lime',
  Numeric: 'bg-qm-fuchsia-light text-qm-fuchsia',
  Range:   'bg-blue-50 text-blue-700',
}

function emptyForm(): ModifierFormData {
  return {
    display_name: '',
    system_lookup_name: null,
    modifier_type: 'Boolean',
    units: null,
    range_min_label: null, range_max_label: null,
    range_min_value: null, range_max_value: null,
    range_default_value: null, range_step_interval: null,
    show_internally: true, show_customer: false, is_system_variable: false,
    active: true,
  }
}

function toFormData(m: Modifier): ModifierFormData {
  return {
    display_name: m.display_name,
    system_lookup_name: m.system_lookup_name,
    modifier_type: m.modifier_type,
    units: m.units,
    range_min_label: m.range_min_label, range_max_label: m.range_max_label,
    range_min_value: m.range_min_value, range_max_value: m.range_max_value,
    range_default_value: m.range_default_value, range_step_interval: m.range_step_interval,
    show_internally: m.show_internally ?? false,
    show_customer: m.show_customer ?? false,
    is_system_variable: m.is_system_variable ?? false,
    active: m.active ?? true,
  }
}

export default function ModifiersClient({ orgId, orgSlug, userId, userRole, initialModifiers }: Props) {
  const router = useRouter()
  const [modifiers] = useState<Modifier[]>(initialModifiers)
  const [search, setSearch] = useState('')

  const {
    sortRules, filterRules, columnWidths: savedWidths, viewMode,
    activeView, isDirty, isViewReadOnly, myViews, sharedViews, viewsLoading,
    setSort, setFilterRules, setColumnWidth, setViewMode, loadView, saveCurrentView, createView, deleteView,
  } = useSavedView({ tableKey: 'modifiers', orgId, userId, userRole })
  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  const COLUMNS = useMemo((): ColumnDef<Modifier>[] => [
    { key: 'display_name', label: 'Display Name', defaultWidth: 220, sortable: true, filterable: true, filterType: 'text', getValue: (m) => m.display_name },
    { key: 'system_lookup_name', label: 'System Name', defaultWidth: 200, sortable: false, filterable: true, filterType: 'text', getValue: (m) => m.system_lookup_name },
    { key: 'modifier_type', label: 'Type', defaultWidth: 130, sortable: true, filterable: true, filterType: 'select', filterOptions: [{ label: 'Boolean', value: 'Boolean' }, { label: 'Numeric', value: 'Numeric' }, { label: 'Range', value: 'Range' }], getValue: (m) => m.modifier_type },
    { key: 'units', label: 'Units', defaultWidth: 110, sortable: false, filterable: false, getValue: (m) => m.units },
    { key: 'show_customer', label: 'Customer', defaultWidth: 100, sortable: false, filterable: true, filterType: 'select', filterOptions: [{ label: 'Customer visible', value: 'true' }, { label: 'Internal only', value: 'false' }], getValue: (m) => m.show_customer ? 'true' : 'false' },
    { key: 'is_system_variable', label: 'System Var', defaultWidth: 110, sortable: false, filterable: true, filterType: 'select', filterOptions: [{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }], getValue: (m) => m.is_system_variable ? 'true' : 'false' },
    { key: 'active', label: 'Active', defaultWidth: 100, sortable: true, filterable: true, filterType: 'select', filterOptions: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }], getValue: (m) => m.active ? 'true' : 'false' },
    { key: 'actions', label: 'Actions', defaultWidth: 100, sortable: false, filterable: false },
  ], [])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  const { widths: colWidths, startResize } = useColumnResize({ defaultWidths, savedWidths, onWidthCommit: setColumnWidth, disabled: isViewReadOnly })

  function SortIcon({ column }: { column: string }) {
    const rule = activeSortRules.find((r) => r.column === column)
    if (rule?.direction === 'asc') return <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75 12 8.25l7.5 7.5" /></svg>
    if (rule?.direction === 'desc') return <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
    return <svg className="h-3 w-3 opacity-20" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
  }

  const totalWidth = COLUMNS.reduce((sum, c) => sum + (colWidths[c.key] ?? c.defaultWidth), 0)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [form, setForm] = useState<ModifierFormData>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<string | null>(null)

  function openEdit(m: Modifier) {
    setForm(toFormData(m))
    setEditingId(m.id)
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

  const filtered = useMemo(() => {
    const byRules = applyFilterRules(modifiers, filterRules, COLUMNS)
    const term = search.trim().toLowerCase()
    const searched = term
      ? byRules.filter((m) => `${m.display_name} ${m.name} ${m.system_lookup_name ?? ''}`.toLowerCase().includes(term))
      : byRules
    return applySortRules(searched, activeSortRules, COLUMNS)
  }, [modifiers, search, filterRules, activeSortRules, COLUMNS])

  function handleSave() {
    setFormError(null)
    startTransition(async () => {
      if (isNew) {
        const result = await createModifier(orgId, orgSlug, form)
        if (result.error) setFormError(result.error)
        else { closeForm(); showToast('Modifier created'); router.refresh() }
      } else if (editingId) {
        const result = await updateModifier(editingId, orgId, orgSlug, form)
        if (result.error) setFormError(result.error)
        else { closeForm(); showToast('Modifier updated'); router.refresh() }
      }
    })
  }

  function handleToggleActive(id: string, nextActive: boolean) {
    startTransition(async () => {
      const result = await toggleModifierActive(id, orgId, orgSlug, nextActive)
      if (result.error) showToast(`Error: ${result.error}`)
      else { showToast(nextActive ? 'Activated' : 'Deactivated'); router.refresh() }
    })
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
          <h1 className="text-2xl font-extrabold text-qm-black">Modifiers</h1>
          <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2.5 py-0.5 text-xs font-semibold text-qm-lime-dark">
            {modifiers.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add New Modifier
          </button>
        </div>
      </div>

      {/* Search + Filters/Views toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by display name or system name..." className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime" />
        </div>
        <div className="ml-auto">
          <DataTableToolbar
            columns={COLUMNS}
            filterRules={filterRules}
            onFilterRulesChange={setFilterRules}
            activeView={activeView}
            myViews={myViews}
            sharedViews={sharedViews}
            isDirty={isDirty}
            isViewReadOnly={isViewReadOnly}
            viewsLoading={viewsLoading}
            currentUserId={userId}
            onLoadView={loadView}
            onSaveView={saveCurrentView}
            onCreateView={createView}
            onDeleteView={deleteView}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />
        </div>
      </div>

      {/* Table */}
      {modifiers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No modifiers yet</p>
          <p className="mt-1 text-sm text-gray-500">Add your first modifier to get started.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-qm-gray">No modifiers match your filters.</p>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((m) => (
            <ModifierCard key={m.id} modifier={m} onClick={() => openEdit(m)} />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="divide-y divide-gray-200 table-fixed" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>
              {COLUMNS.map((col) => <col key={col.key} style={{ width: colWidths[col.key] ?? col.defaultWidth }} />)}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                {COLUMNS.map((col, i) => {
                  const isSortable = col.sortable && !isViewReadOnly
                  const isLast = i === COLUMNS.length - 1
                  const isActions = col.key === 'actions'
                  const isCenter = col.key === 'show_customer' || col.key === 'is_system_variable' || col.key === 'active'
                  return (
                    <th
                      key={col.key}
                      onClick={isSortable ? () => setSort(col.key) : undefined}
                      className={`relative px-6 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${isSortable ? 'cursor-pointer hover:bg-gray-100' : ''} ${isActions ? `text-right ${STICKY_ACTIONS_TH}` : isCenter ? 'text-center' : 'text-left'}`}
                    >
                      <div className={`flex items-center gap-1 ${isActions ? 'justify-end' : isCenter ? 'justify-center' : ''}`}>
                        {col.label}
                        {col.sortable && <SortIcon column={col.key} />}
                      </div>
                      {!isLast && col.resizable !== false && (
                        <div onMouseDown={(e) => startResize(col.key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-qm-lime hover:opacity-30 z-10" />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((m) => (
                <tr key={m.id} className="group hover:bg-gray-50">
                  <td className="overflow-hidden px-6 py-3 text-sm font-semibold text-qm-black"><span className="block truncate">{m.display_name}</span></td>
                  <td className="overflow-hidden px-6 py-3 text-sm text-qm-gray"><span className="block truncate">{m.system_lookup_name ?? <span className="text-gray-300">—</span>}</span></td>
                  <td className="overflow-hidden whitespace-nowrap px-6 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_BADGE[m.modifier_type]}`}>
                      {m.modifier_type}
                    </span>
                  </td>
                  <td className="overflow-hidden whitespace-nowrap px-6 py-3 text-sm text-qm-gray">{m.units ?? <span className="text-gray-300">—</span>}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-center text-sm">{m.show_customer ? '✓' : <span className="text-gray-300">—</span>}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-center text-sm">{m.is_system_variable ? '✓' : <span className="text-gray-300">—</span>}</td>
                  <td className="whitespace-nowrap px-6 py-3 text-center">
                    <button
                      onClick={() => handleToggleActive(m.id, !(m.active ?? true))}
                      disabled={isPending}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${m.active ? 'bg-qm-lime' : 'bg-gray-300'} disabled:opacity-50`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${m.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className={`whitespace-nowrap px-6 py-3 text-right ${STICKY_ACTIONS_TD}`}>
                    <button onClick={() => openEdit(m)} className="text-sm font-medium text-qm-lime hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-2 text-xs text-qm-gray">
            Showing {filtered.length} of {modifiers.length} modifiers
          </div>
        </div>
      )}

      {/* Modal form */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => !isPending && closeForm()} />
          <div className="relative w-full max-w-lg rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-bold text-qm-black">{isNew ? 'New Modifier' : 'Edit Modifier'}</h2>
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

              <Field label="Display Name" required>
                <input type="text" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={inputClass} placeholder="e.g. Pole Pocket 1in" />
              </Field>
              <Field label="System Lookup Name">
                <input type="text" value={form.system_lookup_name ?? ''} onChange={(e) => setForm({ ...form, system_lookup_name: e.target.value || null })} className={inputClass} placeholder="e.g. Pole_Pocket_1in" />
              </Field>

              <Field label="Type">
                <div className="flex gap-4">
                  {(['Boolean', 'Numeric', 'Range'] as ModifierType[]).map((t) => (
                    <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="radio" checked={form.modifier_type === t} onChange={() => setForm({ ...form, modifier_type: t })} className="accent-qm-lime" />
                      {t}
                    </label>
                  ))}
                </div>
              </Field>

              {(form.modifier_type === 'Numeric' || form.modifier_type === 'Range') && (
                <Field label="Units">
                  <select value={form.units ?? ''} onChange={(e) => setForm({ ...form, units: e.target.value || null })} className={inputClass}>
                    <option value="">—</option>
                    {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </Field>
              )}

              {form.modifier_type === 'Range' && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-qm-gray">Range settings</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Min Label">
                      <input type="text" value={form.range_min_label ?? ''} onChange={(e) => setForm({ ...form, range_min_label: e.target.value || null })} className={inputClass} placeholder="Easy" />
                    </Field>
                    <Field label="Max Label">
                      <input type="text" value={form.range_max_label ?? ''} onChange={(e) => setForm({ ...form, range_max_label: e.target.value || null })} className={inputClass} placeholder="Hard" />
                    </Field>
                    <Field label="Min Value">
                      <input type="number" step="0.01" value={form.range_min_value ?? ''} onChange={(e) => setForm({ ...form, range_min_value: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Max Value">
                      <input type="number" step="0.01" value={form.range_max_value ?? ''} onChange={(e) => setForm({ ...form, range_max_value: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Default Value">
                      <input type="number" step="0.01" value={form.range_default_value ?? ''} onChange={(e) => setForm({ ...form, range_default_value: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                    <Field label="Step Interval">
                      <input type="number" step="0.01" value={form.range_step_interval ?? ''} onChange={(e) => setForm({ ...form, range_step_interval: e.target.value === '' ? null : parseFloat(e.target.value) })} className={inputClass} />
                    </Field>
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-2">
                <Toggle label="Show Internally" checked={form.show_internally} onChange={(v) => setForm({ ...form, show_internally: v })} />
                <Toggle label="Show Customer" checked={form.show_customer} onChange={(v) => setForm({ ...form, show_customer: v })} />
                <Toggle label="Is System Variable" checked={form.is_system_variable} onChange={(v) => setForm({ ...form, is_system_variable: v })} />
                <Toggle label="Active" checked={form.active} onChange={(v) => setForm({ ...form, active: v })} />
              </div>
            </div>

            <div className="border-t border-gray-200 bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
              <button onClick={closeForm} disabled={isPending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={handleSave} disabled={isPending} className="rounded-md bg-qm-lime px-5 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {isPending ? 'Saving...' : isNew ? 'Create Modifier' : 'Save Changes'}
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
