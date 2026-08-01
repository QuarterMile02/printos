'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@/components/data-table/types'
import { useSavedView, applyFilterRules, applySortRules } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'
import { ShippingProfileCard } from './shipping-profile-card'

export type ProfileRow = {
  id: string
  name: string
  length_in: number | null
  width_in: number | null
  height_in: number | null
  max_weight_lbs: number | null
  is_active: boolean
}

function dims(p: ProfileRow): string {
  const parts = [p.length_in, p.width_in, p.height_in]
  if (parts.every((v) => v == null)) return '—'
  return parts.map((v) => v ?? '?').join(' × ') + '"'
}

const DEFAULT_SORT = [{ column: 'name', direction: 'asc' as const }]

type Props = {
  profiles: ProfileRow[]
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
}

export default function ShippingProfilesListClient({ profiles, orgSlug, orgId, userId, userRole }: Props) {
  const [search, setSearch] = useState('')

  const {
    sortRules, filterRules, columnWidths: savedWidths, viewMode,
    activeView, isDirty, isViewReadOnly, myViews, sharedViews, viewsLoading,
    setSort, setFilterRules, setColumnWidth, setViewMode, loadView, saveCurrentView, createView, deleteView,
  } = useSavedView({ tableKey: 'shipping_profiles', orgId, userId, userRole })

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  const COLUMNS = useMemo((): ColumnDef<ProfileRow>[] => [
    { key: 'name', label: 'Name', defaultWidth: 220, sortable: true, filterable: true, filterType: 'text', getValue: (p) => p.name },
    { key: 'dims', label: 'Dimensions (L×W×H)', defaultWidth: 180, sortable: false, filterable: false },
    { key: 'max_weight_lbs', label: 'Max Weight', defaultWidth: 130, sortable: true, filterable: false, getValue: (p) => p.max_weight_lbs },
    { key: 'is_active', label: 'Active', defaultWidth: 100, sortable: true, filterable: true, filterType: 'select', filterOptions: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }], getValue: (p) => p.is_active ? 'true' : 'false' },
    { key: 'actions', label: 'Actions', defaultWidth: 100, sortable: false, filterable: false },
  ], [])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  const { widths: colWidths, startResize } = useColumnResize({ defaultWidths, savedWidths, onWidthCommit: setColumnWidth, disabled: isViewReadOnly })

  const filtered = useMemo(() => applyFilterRules(profiles, filterRules, COLUMNS), [profiles, filterRules, COLUMNS])
  const searched = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return filtered
    return filtered.filter((p) => p.name.toLowerCase().includes(term))
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

      {viewMode === 'card' ? (
        sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
            <p className="text-sm text-gray-500">
              {search || filterRules.length > 0 ? 'No shipping profiles match the current filters.' : 'No shipping profiles yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {sorted.map((p) => (
              <ShippingProfileCard key={p.id} profile={p} orgSlug={orgSlug} />
            ))}
          </div>
        )
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
                  return (
                    <th
                      key={col.key}
                      onClick={isSortable ? () => setSort(col.key) : undefined}
                      className={`relative px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${isSortable ? 'cursor-pointer hover:bg-gray-100' : ''} ${isActions ? `text-right ${STICKY_ACTIONS_TH}` : 'text-left'}`}
                    >
                      <div className={`flex items-center gap-1 ${isActions ? 'justify-end' : ''}`}>
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
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-gray-500">
                    {search || filterRules.length > 0 ? 'No shipping profiles match the current filters.' : 'No shipping profiles yet.'}
                  </td>
                </tr>
              ) : sorted.map((p) => {
                const editHref = `/dashboard/${orgSlug}/settings/shipping-profiles?edit=${p.id}`
                return (
                  <tr key={p.id} className="group hover:bg-gray-50">
                    <td className="overflow-hidden px-4 py-3">
                      <Link href={editHref} className="block truncate text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{p.name}</Link>
                    </td>
                    <td className="overflow-hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600 font-mono">{dims(p)}</td>
                    <td className="overflow-hidden whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {p.max_weight_lbs != null ? `${p.max_weight_lbs} lbs` : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block h-2 w-2 rounded-full ${p.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                    </td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap ${STICKY_ACTIONS_TD}`}>
                      <Link href={editHref} className="text-sm text-qm-lime hover:underline">Edit</Link>
                    </td>
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
