'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import type { ColumnDef, FilterRule } from '@/components/data-table/types'
import { useSavedView } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { DataTableError } from '@/components/data-table/data-table-error'
import { MaterialCard } from './material-card'
import { MATERIALS_PAGE_SIZE } from './constants'

// ── Row type ──────────────────────────────────────────────────────────────────

export type MaterialListRow = {
  id: string
  name: string
  external_name: string | null
  cost: number | null
  price: number | null
  selling_units: string | null
  material_type_id: string | null
  category_id: string | null
  active: boolean | null
}

export type MaterialTypeOption = { id: string; name: string }
export type MaterialCategoryOption = { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_SELECT = 'id, name, external_name, cost, price, selling_units, material_type_id, category_id, active'
const PAGE_SIZE = MATERIALS_PAGE_SIZE
const SEARCH_COLUMNS = ['name', 'external_name', 'part_number', 'sku']

const DEFAULT_SORT = [{ column: 'name', direction: 'asc' as const }]

function formatMoney(v: number | null): string {
  if (v == null) return '—'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Dash() {
  return <span className="text-gray-300">—</span>
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: MaterialListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
  materialTypes: MaterialTypeOption[]
  materialCategories: MaterialCategoryOption[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MaterialsListClient({
  initialRows,
  initialTotalCount,
  orgSlug,
  orgId,
  userId,
  userRole,
  materialTypes,
  materialCategories,
}: Props) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const {
    sortRules,
    filterRules,
    columnWidths: savedWidths,
    viewMode,
    activeView,
    isDirty,
    isViewReadOnly,
    myViews,
    sharedViews,
    viewsLoading,
    setSort,
    setFilterRules,
    setColumnWidth,
    setViewMode,
    loadView,
    saveCurrentView,
    createView,
    deleteView,
  } = useSavedView({ tableKey: 'materials', orgId, userId, userRole })

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  // The Type dropdown acts as an override: strip any material_type_id
  // rules from the saved-view filterRules and inject the dropdown's
  // constraint — same pattern as PO's status tabs.
  const effectiveFilterRules = useMemo((): FilterRule[] => {
    if (typeFilter === 'all') return filterRules
    const base = filterRules.filter((r) => r.column !== 'material_type_id')
    return [...base, { id: '__type_filter__', column: 'material_type_id', operator: 'equals' as const, value: typeFilter }]
  }, [filterRules, typeFilter])

  const typeMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of materialTypes) m[t.id] = t.name
    return m
  }, [materialTypes])

  const categoryMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of materialCategories) m[c.id] = c.name
    return m
  }, [materialCategories])

  // ── Column definitions ────────────────────────────────────────────────────
  const COLUMNS = useMemo((): ColumnDef<MaterialListRow>[] => [
    {
      key: 'name', label: 'Name', defaultWidth: 260,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (m) => m.name,
    },
    {
      key: 'type', label: 'Type', defaultWidth: 160,
      sortable: false, filterable: false,
      getValue: (m) => m.material_type_id ? typeMap[m.material_type_id] ?? null : null,
    },
    {
      key: 'category', label: 'Category', defaultWidth: 160,
      sortable: false, filterable: false,
      getValue: (m) => m.category_id ? categoryMap[m.category_id] ?? null : null,
    },
    {
      key: 'cost', label: 'Cost', defaultWidth: 110,
      sortable: true, filterable: false,
      getValue: (m) => m.cost,
    },
    {
      key: 'price', label: 'Sell Price', defaultWidth: 110,
      sortable: true, filterable: false,
      getValue: (m) => m.price,
    },
    {
      key: 'selling_units', label: 'Selling Units', defaultWidth: 130,
      sortable: false, filterable: false,
      getValue: (m) => m.selling_units,
    },
    {
      key: 'active', label: 'Active', defaultWidth: 90,
      sortable: false, filterable: false,
      getValue: (m) => m.active ? 'Active' : 'Inactive',
    },
  ], [typeMap, categoryMap])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  const { widths: colWidths, startResize } = useColumnResize({
    defaultWidths,
    savedWidths,
    onWidthCommit: setColumnWidth,
    disabled: isViewReadOnly,
  })

  const { rows: liveRows, totalCount: liveTotalCount, loading, error } = useDataTableQuery<MaterialListRow>({
    tableKey: 'materials',
    orgId,
    select: DB_SELECT,
    filterRules: effectiveFilterRules,
    sortRules: activeSortRules,
    search,
    searchColumns: SEARCH_COLUMNS,
    page,
    pageSize: PAGE_SIZE,
    initialRows,
    initialTotalCount,
  })

  useEffect(() => { setPage(1) }, [filterRules, sortRules, typeFilter])

  function SortIcon({ column }: { column: string }) {
    const rule = activeSortRules.find((r) => r.column === column)
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
  const totalPages = Math.max(1, Math.ceil(liveTotalCount / PAGE_SIZE))

  if (initialRows.length === 0 && typeFilter === 'all' && filterRules.length === 0 && !search && !loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <p className="text-sm font-medium text-gray-900">No materials yet</p>
        <p className="mt-1 text-sm text-gray-500">Add your first material or import from a CSV.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search + Type filter + Filters/Views toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          {loading && search.length >= 2 ? (
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-lime animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          )}
          <input
            type="text"
            placeholder="Search by name, external name, part number, SKU..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="all">All types</option>
          {materialTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

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

      {/* Card grid / Table */}
      {error ? (
        <DataTableError />
      ) : liveRows.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-gray-500">
            {search ? `No materials match "${search}"` : 'No materials match the current filters.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {liveRows.map((m) => (
              <MaterialCard
                key={m.id}
                material={m}
                orgSlug={orgSlug}
                typeName={m.material_type_id ? typeMap[m.material_type_id] ?? null : null}
              />
            ))}
          </div>
          <div className="mt-3 text-xs text-qm-gray">
            {liveTotalCount === 0
              ? '0 materials'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()} materials`}
          </div>
        </div>
      ) : (
        <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <table className="divide-y divide-gray-200 table-fixed" style={{ width: totalWidth, minWidth: '100%' }}>
            <colgroup>
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: colWidths[col.key] ?? col.defaultWidth }} />
              ))}
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                {COLUMNS.map((col, i) => {
                  const isSortable = col.sortable && !isViewReadOnly
                  const isLast = i === COLUMNS.length - 1
                  const isRight = col.key === 'cost' || col.key === 'price'
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
              {liveRows.map((m) => {
                const href = `/dashboard/${orgSlug}/settings/materials/${m.id}`
                return (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="overflow-hidden">
                      <Link href={href} className="block px-4 py-3 min-w-0">
                        <div className="truncate text-sm font-semibold text-qm-black">{m.name}</div>
                        {m.external_name && <div className="truncate text-xs text-qm-gray">{m.external_name}</div>}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-qm-gray">
                        {m.material_type_id ? typeMap[m.material_type_id] ?? <Dash /> : <Dash />}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-qm-gray">
                        {m.category_id ? categoryMap[m.category_id] ?? <Dash /> : <Dash />}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-right text-qm-black">{formatMoney(m.cost)}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-right font-medium text-qm-black">{formatMoney(m.price)}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-qm-gray">{m.selling_units ?? <Dash />}</Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={href} className="block">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${m.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {m.active ? 'Active' : 'Inactive'}
                        </span>
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-3 text-sm text-gray-500">
            <span>
              {liveTotalCount === 0
                ? '0 materials'
                : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()}`}
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(1)} disabled={page === 1} className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">«</button>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">‹ Prev</button>
                <span className="px-2 text-xs font-medium">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">Next ›</button>
                <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">»</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
