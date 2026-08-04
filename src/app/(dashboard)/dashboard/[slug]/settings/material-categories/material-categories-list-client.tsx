'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { deleteMaterialCategory } from './actions-sr'
import type { ColumnDef, FilterRule } from '@/components/data-table/types'
import { useSavedView } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { DataTableError } from '@/components/data-table/data-table-error'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'
import { MATERIAL_CATEGORIES_PAGE_SIZE } from './constants'

// ── Row type ──────────────────────────────────────────────────────────────────

export type MaterialCategoryListRow = {
  id: string
  name: string
  material_type_id: string | null
  is_active: boolean
}

export type MaterialTypeOption = { id: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_SELECT = 'id, name, material_type_id, is_active'
const PAGE_SIZE = MATERIAL_CATEGORIES_PAGE_SIZE
const SEARCH_COLUMNS = ['name']

const DEFAULT_SORT = [{ column: 'name', direction: 'asc' as const }]

type StatusTab = 'all' | 'enabled' | 'disabled'

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: MaterialCategoryListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
  materialTypes: MaterialTypeOption[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MaterialCategoriesListClient({
  initialRows,
  initialTotalCount,
  orgSlug,
  orgId,
  userId,
  userRole,
  materialTypes,
}: Props) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')
  const [tabCounts, setTabCounts] = useState({ all: initialTotalCount, enabled: 0, disabled: 0 })

  useEffect(() => {
    let cancelled = false
    const client = createClient()
    Promise.all([
      client.from('material_categories').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      client.from('material_categories').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
      client.from('material_categories').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', false),
    ]).then(([all, enabled, disabled]) => {
      if (cancelled) return
      setTabCounts({ all: all.count ?? 0, enabled: enabled.count ?? 0, disabled: disabled.count ?? 0 })
    })
    return () => { cancelled = true }
  }, [orgId])

  const {
    sortRules,
    filterRules,
    columnWidths: savedWidths,
    activeView,
    isDirty,
    isViewReadOnly,
    myViews,
    sharedViews,
    viewsLoading,
    setSort,
    setFilterRules,
    setColumnWidth,
    loadView,
    saveCurrentView,
    createView,
    deleteView,
  } = useSavedView({ tableKey: 'material_categories', orgId, userId, userRole })

  // Tab acts as an override: strip any is_active rules from the saved-view
  // filterRules and inject the tab's constraint -- same pattern used for
  // Materials' Type dropdown and Purchase Orders' status tabs.
  const effectiveFilterRules = useMemo((): FilterRule[] => {
    const base = filterRules.filter((r) => r.column !== 'is_active')
    if (tab === 'all') return base
    return [...base, { id: '__status_tab__', column: 'is_active', operator: 'equals' as const, value: tab === 'enabled' ? 'true' : 'false' }]
  }, [filterRules, tab])

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  const typeMap = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of materialTypes) m[t.id] = t.name
    return m
  }, [materialTypes])

  // ── Column definitions ────────────────────────────────────────────────────
  const COLUMNS = useMemo((): ColumnDef<MaterialCategoryListRow>[] => [
    {
      key: 'name', label: 'Name', defaultWidth: 260,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (c) => c.name,
    },
    {
      key: 'material_type_id', label: 'Material Type', defaultWidth: 200,
      sortable: false, filterable: true, filterType: 'select',
      filterOptions: materialTypes.map((t) => ({ label: t.name, value: t.id })),
      getValue: (c) => c.material_type_id ? typeMap[c.material_type_id] ?? null : null,
    },
    {
      key: 'is_active', label: 'Active', defaultWidth: 110,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }],
      getValue: (c) => c.is_active ? 'Active' : 'Inactive',
    },
    {
      key: 'actions', label: 'Actions', defaultWidth: 160,
      sortable: false, filterable: false,
    },
  ], [materialTypes, typeMap])

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

  const { rows: liveRows, totalCount: liveTotalCount, loading, error } = useDataTableQuery<MaterialCategoryListRow>({
    tableKey: 'material_categories',
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

  useEffect(() => { setPage(1) }, [filterRules, sortRules, tab])

  // Usage counts aren't a column on `material_categories` — fetch for the
  // rows currently on screen, same pattern used for Discounts' tier counts.
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    const ids = liveRows.map((r) => r.id)
    if (ids.length === 0) { setUsageCounts({}); return }
    let cancelled = false
    createClient()
      .from('materials')
      .select('category_id')
      .in('category_id', ids)
      .then(({ data }) => {
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const m of (data ?? []) as { category_id: string }[]) {
          counts[m.category_id] = (counts[m.category_id] ?? 0) + 1
        }
        setUsageCounts(counts)
      })
    return () => { cancelled = true }
  }, [liveRows])

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

  if (initialRows.length === 0 && filterRules.length === 0 && !search && !loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <p className="text-sm font-medium text-gray-900">No material categories yet</p>
        <p className="mt-1 text-sm text-gray-500">Add your first category above.</p>
      </div>
    )
  }

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

      {/* Search + Filters/Views toolbar */}
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
            placeholder="Search by name..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
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
          />
        </div>
      </div>

      {error ? (
        <DataTableError />
      ) : liveRows.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-gray-500">
            {search ? `No categories match "${search}"` : 'No categories match the current filters.'}
          </p>
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
              {liveRows.map((c) => {
                const editHref = `/dashboard/${orgSlug}/settings/material-categories?edit=${c.id}`
                // Delete requires BOTH: already deactivated, AND zero linked
                // records. Linked records is checked first since
                // deactivating alone wouldn't unblock delete while records
                // are still linked.
                const inUseCount = usageCounts[c.id] ?? 0
                const inUse = inUseCount > 0
                const canDelete = !c.is_active && !inUse
                const deleteBlockedReason = inUse
                  ? `Cannot delete — used by ${inUseCount} material${inUseCount === 1 ? '' : 's'}. Modify those first.`
                  : 'Deactivate this category first before it can be deleted.'
                return (
                  <tr key={c.id} className="group hover:bg-gray-50">
                    <td className="overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 truncate text-sm font-medium text-gray-900 hover:text-qm-fuchsia">
                        {c.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 text-sm text-gray-500">
                        {c.material_type_id ? typeMap[c.material_type_id] ?? '—' : '—'}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={editHref} className="block">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${c.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {c.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </Link>
                    </td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap ${STICKY_ACTIONS_TD}`}>
                      <div className="flex items-center justify-end gap-3">
                        <Link href={editHref} className="text-sm text-qm-lime hover:underline">
                          Edit
                        </Link>
                        {canDelete ? (
                          <form action={deleteMaterialCategory} className="inline">
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="orgSlug" value={orgSlug} />
                            <button type="submit" className="text-sm text-red-500 hover:underline">
                              Delete
                            </button>
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

          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-3 text-sm text-gray-500">
            <span>
              {liveTotalCount === 0
                ? '0 categories'
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
