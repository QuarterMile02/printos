'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { ColumnDef, FilterRule } from '@/components/data-table/types'
import { useSavedView } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { DataTableError } from '@/components/data-table/data-table-error'
import { SettingsTabs, type SettingsTab } from '@/components/settings/settings-tabs'
import { SettingsSearchInput } from '@/components/settings/settings-search-input'
import { DiscountCard } from './discount-card'
import { DISCOUNTS_PAGE_SIZE, DISCOUNT_TYPES, DISCOUNT_APPLIES_TO } from './constants'

// ── Row type ──────────────────────────────────────────────────────────────────

export type DiscountListRow = {
  id: string
  name: string
  discount_type: string | null
  applies_to: string | null
  active: boolean | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_SELECT = 'id, name, discount_type, applies_to, active'
const PAGE_SIZE = DISCOUNTS_PAGE_SIZE
const SEARCH_COLUMNS = ['name']

const DEFAULT_SORT = [{ column: 'name', direction: 'asc' as const }]

type StatusTab = 'all' | 'enabled' | 'disabled'

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: DiscountListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DiscountsListClient({
  initialRows,
  initialTotalCount,
  orgSlug,
  orgId,
  userId,
  userRole,
}: Props) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')
  const [tabCounts, setTabCounts] = useState({ all: initialTotalCount, enabled: 0, disabled: 0 })

  useEffect(() => {
    let cancelled = false
    const client = createClient()
    Promise.all([
      client.from('discounts').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      client.from('discounts').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('active', true),
      client.from('discounts').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('active', false),
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
  } = useSavedView({ tableKey: 'discounts', orgId, userId, userRole })

  // Tab acts as an override: strip any active rules from the saved-view
  // filterRules and inject the tab's constraint.
  const effectiveFilterRules = useMemo((): FilterRule[] => {
    const base = filterRules.filter((r) => r.column !== 'active')
    if (tab === 'all') return base
    return [...base, { id: '__status_tab__', column: 'active', operator: 'equals' as const, value: tab === 'enabled' ? 'true' : 'false' }]
  }, [filterRules, tab])

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  // ── Column definitions ────────────────────────────────────────────────────
  const COLUMNS = useMemo((): ColumnDef<DiscountListRow>[] => [
    {
      key: 'name', label: 'Name', defaultWidth: 240,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (d) => d.name,
    },
    {
      key: 'discount_type', label: 'Type', defaultWidth: 130,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: DISCOUNT_TYPES.map((t) => ({ label: t, value: t })),
      getValue: (d) => d.discount_type,
    },
    {
      key: 'applies_to', label: 'Applies To', defaultWidth: 130,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: DISCOUNT_APPLIES_TO.map((a) => ({ label: a, value: a })),
      getValue: (d) => d.applies_to,
    },
    {
      key: 'tiers', label: 'Tiers', defaultWidth: 90,
      sortable: false, filterable: false, resizable: true,
    },
    {
      key: 'active', label: 'Active', defaultWidth: 100,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }],
      getValue: (d) => d.active !== false ? 'Active' : 'Inactive',
    },
  ], [])

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

  const { rows: liveRows, totalCount: liveTotalCount, loading, error } = useDataTableQuery<DiscountListRow>({
    tableKey: 'discounts',
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

  // Tier counts aren't a column on `discounts` — fetch them separately for
  // whichever rows are currently on screen.
  const [tierCounts, setTierCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    const ids = liveRows.map((r) => r.id)
    if (ids.length === 0) { setTierCounts({}); return }
    let cancelled = false
    createClient()
      .from('discount_tiers')
      .select('discount_id')
      .in('discount_id', ids)
      .then(({ data }) => {
        if (cancelled) return
        const counts: Record<string, number> = {}
        for (const t of (data ?? []) as { discount_id: string }[]) {
          counts[t.discount_id] = (counts[t.discount_id] ?? 0) + 1
        }
        setTierCounts(counts)
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
        <p className="text-sm font-medium text-gray-900">No discounts yet</p>
        <p className="mt-1 text-sm text-gray-500">Add your first discount to get started.</p>
      </div>
    )
  }

  const TABS: SettingsTab<StatusTab>[] = [
    { key: 'all', label: 'All', count: tabCounts.all },
    { key: 'enabled', label: 'Enabled', count: tabCounts.enabled },
    { key: 'disabled', label: 'Disabled', count: tabCounts.disabled },
  ]

  return (
    <div className="space-y-4">
      <SettingsTabs tabs={TABS} active={tab} onChange={setTab} />

      {/* Search + Filters/Views toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <SettingsSearchInput
          value={search}
          onChange={(v) => { setSearch(v); setPage(1) }}
          placeholder="Search by name..."
          showSpinner={loading && search.length >= 2}
        />

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
            {search ? `No discounts match "${search}"` : 'No discounts match the current filters.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {liveRows.map((d) => (
              <DiscountCard
                key={d.id}
                discount={d}
                orgSlug={orgSlug}
                tierCount={tierCounts[d.id] ?? 0}
              />
            ))}
          </div>
          <div className="mt-3 text-xs text-qm-gray">
            {liveTotalCount === 0
              ? '0 discounts'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()} discounts`}
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
                  const isRight = col.key === 'tiers'
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
              {liveRows.map((d) => {
                const href = `/dashboard/${orgSlug}/settings/discounts/${d.id}`
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="overflow-hidden">
                      <Link href={href} className="block px-4 py-3 min-w-0 truncate text-sm font-medium text-gray-900 hover:text-qm-fuchsia">
                        {d.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          d.discount_type === 'Volume' ? 'bg-blue-50 text-blue-700' :
                          d.discount_type === 'Range' ? 'bg-amber-50 text-amber-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{d.discount_type ?? '—'}</span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-600">{d.applies_to ?? '—'}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-900 text-right tabular-nums">{tierCounts[d.id] ?? 0}</Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={href} className="block">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${d.active !== false ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {d.active !== false ? 'Active' : 'Inactive'}
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
                ? '0 discounts'
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
