'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@/components/data-table/types'
import { useSavedView, applyFilterRules, applySortRules } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { MachineRateCard } from './machine-rate-card'

export type MachineRateRow = {
  id: string
  name: string
  external_name: string | null
  cost: number | null
  price: number | null
  markup: number | null
  formula: string | null
  units: string | null
  production_rate: number | null
  active: boolean | null
  department_id: string | null
}

const FORMULAS = ['Area', 'Perimeter', 'Width', 'Height', 'Unit', 'Fixed Qty']
const UNITS = ['Hr', 'Each', 'Sqft', 'Feet', 'Inch', 'Yard', 'Roll', 'Sheet']

const DEFAULT_SORT = [{ column: 'name', direction: 'asc' as const }]

const n = (v: number | null | undefined, d = 0) => Number(v ?? d)

type Props = {
  rates: MachineRateRow[]
  rateDeptMap: Record<string, string[]>
  deptMap: Record<string, string>
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
}

export default function MachineRatesListClient({ rates, rateDeptMap, deptMap, orgSlug, orgId, userId, userRole }: Props) {
  const [search, setSearch] = useState('')

  const {
    sortRules, filterRules, columnWidths: savedWidths, viewMode,
    activeView, isDirty, isViewReadOnly, myViews, sharedViews, viewsLoading,
    setSort, setFilterRules, setColumnWidth, setViewMode, loadView, saveCurrentView, createView, deleteView,
  } = useSavedView({ tableKey: 'machine_rates', orgId, userId, userRole })

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  function deptLabel(r: MachineRateRow): string {
    const dIds = rateDeptMap[r.id] ?? []
    if (dIds.length > 0) return dIds.map((id) => deptMap[id]).filter(Boolean).join(', ') || '—'
    return r.department_id ? (deptMap[r.department_id] ?? '—') : '—'
  }

  const COLUMNS = useMemo((): ColumnDef<MachineRateRow>[] => [
    { key: 'name', label: 'Name', defaultWidth: 200, sortable: true, filterable: true, filterType: 'text', getValue: (r) => r.name },
    { key: 'external_name', label: 'Ext. Name', defaultWidth: 160, sortable: false, filterable: true, filterType: 'text', getValue: (r) => r.external_name },
    { key: 'department', label: 'Department', defaultWidth: 160, sortable: false, filterable: false, getValue: (r) => deptLabel(r) },
    { key: 'cost', label: 'Cost', defaultWidth: 100, sortable: true, filterable: false, getValue: (r) => r.cost },
    { key: 'price', label: 'Price', defaultWidth: 100, sortable: true, filterable: false, getValue: (r) => r.price },
    { key: 'markup', label: 'Markup', defaultWidth: 90, sortable: true, filterable: false, getValue: (r) => r.markup },
    { key: 'formula', label: 'Formula', defaultWidth: 120, sortable: true, filterable: true, filterType: 'select', filterOptions: FORMULAS.map((f) => ({ label: f, value: f })), getValue: (r) => r.formula },
    { key: 'units', label: 'Units', defaultWidth: 90, sortable: true, filterable: true, filterType: 'select', filterOptions: UNITS.map((u) => ({ label: u, value: u })), getValue: (r) => r.units },
    { key: 'production_rate', label: 'Prod. Rate', defaultWidth: 110, sortable: true, filterable: false, getValue: (r) => r.production_rate },
    { key: 'active', label: 'Active', defaultWidth: 90, sortable: true, filterable: true, filterType: 'select', filterOptions: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }], getValue: (r) => r.active !== false ? 'true' : 'false' },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rateDeptMap, deptMap])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  const { widths: colWidths, startResize } = useColumnResize({ defaultWidths, savedWidths, onWidthCommit: setColumnWidth, disabled: isViewReadOnly })

  const filtered = useMemo(() => applyFilterRules(rates, filterRules, COLUMNS), [rates, filterRules, COLUMNS])
  const searched = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return filtered
    return filtered.filter((r) => r.name.toLowerCase().includes(term) || (r.external_name ?? '').toLowerCase().includes(term))
  }, [filtered, search])
  const sorted = useMemo(() => applySortRules(searched, activeSortRules, COLUMNS), [searched, activeSortRules, COLUMNS])

  function SortIcon({ column }: { column: string }) {
    const rule = activeSortRules.find((r) => r.column === column)
    if (rule?.direction === 'asc') return <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75 12 8.25l7.5 7.5" /></svg>
    if (rule?.direction === 'desc') return <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
    return <svg className="h-3 w-3 opacity-20" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
  }

  const totalWidth = COLUMNS.reduce((sum, c) => sum + (colWidths[c.key] ?? c.defaultWidth), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
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

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-gray-500">
            {search || filterRules.length > 0 ? 'No machine rates match the current filters.' : 'No machine rates yet.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {sorted.map((r) => {
            const label = deptLabel(r)
            return (
              <MachineRateCard key={r.id} rate={r} orgSlug={orgSlug} deptLabel={label === '—' ? null : label} />
            )
          })}
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
                  const isRight = col.key === 'cost' || col.key === 'price' || col.key === 'markup' || col.key === 'production_rate'
                  return (
                    <th
                      key={col.key}
                      onClick={isSortable ? () => setSort(col.key) : undefined}
                      className={`relative px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${isSortable ? 'cursor-pointer hover:bg-gray-100' : ''} ${isRight ? 'text-right' : 'text-left'}`}
                    >
                      <div className={`flex items-center gap-1 ${isRight ? 'justify-end' : ''}`}>
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
              {sorted.map((r) => {
                const editHref = `/dashboard/${orgSlug}/settings/machine-rates?edit=${r.id}`
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="overflow-hidden px-4 py-3"><Link href={editHref} className="block truncate text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{r.name}</Link></td>
                    <td className="overflow-hidden whitespace-nowrap px-4 py-3 text-sm text-gray-500">{r.external_name ?? '—'}</td>
                    <td className="overflow-hidden whitespace-nowrap px-4 py-3 text-sm text-gray-500">{deptLabel(r)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 text-right tabular-nums">${n(r.cost).toFixed(2)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900 text-right tabular-nums">${n(r.price).toFixed(2)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{n(r.markup, 1).toFixed(2)}x</td>
                    <td className="overflow-hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600">{r.formula ?? '—'}</td>
                    <td className="overflow-hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600">{r.units ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 text-right tabular-nums">{r.production_rate != null ? n(r.production_rate) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-center"><span className={`inline-block h-2 w-2 rounded-full ${r.active !== false ? 'bg-green-500' : 'bg-gray-300'}`} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
