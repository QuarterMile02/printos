'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { deleteProductType } from './actions-sr'
import type { ColumnDef } from '@/components/data-table/types'
import { useSavedView, applyFilterRules, applySortRules } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'
import { ProductTypeCard } from './product-type-card'

export type ProductTypeRow = {
  id: string
  name: string
  is_active: boolean
}

const DEFAULT_SORT = [{ column: 'name', direction: 'asc' as const }]

type Props = {
  types: ProductTypeRow[]
  usageCounts: Record<string, number>
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
}

type StatusTab = 'all' | 'enabled' | 'disabled'

export default function ProductTypesListClient({ types, usageCounts, orgSlug, orgId, userId, userRole }: Props) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')

  const tabCounts = useMemo(() => ({
    all:      types.length,
    enabled:  types.filter((t) => t.is_active).length,
    disabled: types.filter((t) => !t.is_active).length,
  }), [types])

  const tabbed = useMemo(() => types.filter((t) => {
    if (tab === 'enabled')  return t.is_active
    if (tab === 'disabled') return !t.is_active
    return true
  }), [types, tab])

  const {
    sortRules, filterRules, columnWidths: savedWidths, viewMode,
    activeView, isDirty, isViewReadOnly, myViews, sharedViews, viewsLoading,
    setSort, setFilterRules, setColumnWidth, setViewMode, loadView, saveCurrentView, createView, deleteView,
  } = useSavedView({ tableKey: 'product_types', orgId, userId, userRole })

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  const COLUMNS = useMemo((): ColumnDef<ProductTypeRow>[] => [
    { key: 'name', label: 'Name', defaultWidth: 260, sortable: true, filterable: true, filterType: 'text', getValue: (t) => t.name },
    { key: 'products', label: 'Products', defaultWidth: 120, sortable: false, filterable: false },
    { key: 'is_active', label: 'Active', defaultWidth: 100, sortable: true, filterable: true, filterType: 'select', filterOptions: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }], getValue: (t) => t.is_active ? 'true' : 'false' },
    { key: 'actions', label: 'Actions', defaultWidth: 130, sortable: false, filterable: false },
  ], [])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  const { widths: colWidths, startResize } = useColumnResize({ defaultWidths, savedWidths, onWidthCommit: setColumnWidth, disabled: isViewReadOnly })

  const filtered = useMemo(() => applyFilterRules(tabbed, filterRules, COLUMNS), [tabbed, filterRules, COLUMNS])
  const searched = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return filtered
    return filtered.filter((t) => t.name.toLowerCase().includes(term))
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
      {/* Status tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['all', 'enabled', 'disabled'] as StatusTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-qm-lime text-qm-lime'
                : 'border-transparent text-qm-gray hover:text-qm-black'
            }`}
          >
            {t === 'all' ? 'All' : t === 'enabled' ? 'Enabled' : 'Disabled'}
            <span className="ml-1.5 text-xs text-qm-gray">({tabCounts[t]})</span>
          </button>
        ))}
      </div>

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
              {search || filterRules.length > 0 ? 'No product types match the current filters.' : 'No product types yet.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {sorted.map((t) => (
              <ProductTypeCard key={t.id} type={t} orgSlug={orgSlug} count={usageCounts[t.id] ?? 0} />
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
                  const isRight = col.key === 'products' || isActions
                  return (
                    <th
                      key={col.key}
                      onClick={isSortable ? () => setSort(col.key) : undefined}
                      className={`relative px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${isSortable ? 'cursor-pointer hover:bg-gray-100' : ''} ${isRight ? `text-right ${isActions ? STICKY_ACTIONS_TH : ''}` : 'text-left'}`}
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
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-gray-500">
                    {search || filterRules.length > 0 ? 'No product types match the current filters.' : 'No product types yet.'}
                  </td>
                </tr>
              ) : sorted.map((t) => {
                const editHref = `/dashboard/${orgSlug}/settings/product-types?edit=${t.id}`
                // Delete requires BOTH: already deactivated, AND zero linked
                // records. Linked records is checked first since
                // deactivating alone wouldn't unblock delete while records
                // are still linked.
                const inUseCount = usageCounts[t.id] ?? 0
                const inUse = inUseCount > 0
                const canDelete = !t.is_active && !inUse
                const deleteBlockedReason = inUse
                  ? `Cannot delete — used by ${inUseCount} product${inUseCount === 1 ? '' : 's'}. Modify those first.`
                  : 'Deactivate this product type first before it can be deleted.'
                return (
                  <tr key={t.id} className="group hover:bg-gray-50">
                    <td className="overflow-hidden px-4 py-3">
                      <Link href={editHref} className="block truncate text-sm font-medium text-gray-900 hover:text-qm-fuchsia">{t.name}</Link>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-gray-500 tabular-nums">{usageCounts[t.id] ?? 0}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block h-2 w-2 rounded-full ${t.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                    </td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap ${STICKY_ACTIONS_TD}`}>
                      <div className="flex items-center justify-end gap-3">
                        <Link href={editHref} className="text-sm text-qm-lime hover:underline">Edit</Link>
                        {canDelete ? (
                          <form action={deleteProductType} className="inline">
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <button type="submit" className="text-sm text-red-500 hover:underline">Delete</button>
                          </form>
                        ) : (
                          <span title={deleteBlockedReason} className="text-xs text-gray-400 cursor-not-allowed">Delete</span>
                        )}
                      </div>
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
