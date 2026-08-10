'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { deletePromoCode } from './actions-sr'
import type { ColumnDef, FilterRule } from '@/components/data-table/types'
import { useSavedView } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { DataTableError } from '@/components/data-table/data-table-error'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'
import { SettingsTabs, type SettingsTab } from '@/components/settings/settings-tabs'
import { SettingsSearchInput } from '@/components/settings/settings-search-input'
import { PromoCodeCard } from './promo-code-card'
import { PROMO_CODES_PAGE_SIZE, PROMO_CODE_TYPES } from './constants'

// ── Row type ──────────────────────────────────────────────────────────────────

export type PromoCodeListRow = {
  id: string
  name: string
  code: string
  discount_type: string | null
  value: number | null
  minimum_requirement: number | null
  limit_of_using: number | null
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_SELECT = 'id, name, code, discount_type, value, minimum_requirement, limit_of_using, valid_from, valid_to, is_active'
const PAGE_SIZE = PROMO_CODES_PAGE_SIZE
const SEARCH_COLUMNS = ['name', 'code']

const DEFAULT_SORT = [{ column: 'name', direction: 'asc' as const }]

type StatusTab = 'all' | 'enabled' | 'disabled'

function fmtMoney(v: number | null): string {
  if (v == null) return '—'
  return '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: PromoCodeListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PromoCodesListClient({
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
      client.from('promo_codes').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      client.from('promo_codes').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
      client.from('promo_codes').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', false),
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
  } = useSavedView({ tableKey: 'promo_codes', orgId, userId, userRole })

  // Tab acts as an override: strip any is_active rules from the saved-view
  // filterRules and inject the tab's constraint.
  const effectiveFilterRules = useMemo((): FilterRule[] => {
    const base = filterRules.filter((r) => r.column !== 'is_active')
    if (tab === 'all') return base
    return [...base, { id: '__status_tab__', column: 'is_active', operator: 'equals' as const, value: tab === 'enabled' ? 'true' : 'false' }]
  }, [filterRules, tab])

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  // ── Column definitions ────────────────────────────────────────────────────
  const COLUMNS = useMemo((): ColumnDef<PromoCodeListRow>[] => [
    {
      key: 'name', label: 'Name', defaultWidth: 200,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (p) => p.name,
    },
    {
      key: 'code', label: 'Code', defaultWidth: 160,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (p) => p.code,
    },
    {
      key: 'discount_type', label: 'Type', defaultWidth: 110,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: PROMO_CODE_TYPES.map((t) => ({ label: t, value: t })),
      getValue: (p) => p.discount_type,
    },
    {
      key: 'value', label: 'Value', defaultWidth: 90,
      sortable: true, filterable: false,
      getValue: (p) => p.value,
    },
    {
      key: 'minimum_requirement', label: 'Min. Order', defaultWidth: 110,
      sortable: true, filterable: false,
      getValue: (p) => p.minimum_requirement,
    },
    {
      key: 'limit_of_using', label: 'Limit', defaultWidth: 90,
      sortable: true, filterable: false,
      getValue: (p) => p.limit_of_using,
    },
    {
      key: 'valid_from', label: 'Valid From', defaultWidth: 120,
      sortable: true, filterable: false,
      getValue: (p) => p.valid_from,
    },
    {
      key: 'valid_to', label: 'Valid To', defaultWidth: 120,
      sortable: true, filterable: false,
      getValue: (p) => p.valid_to,
    },
    {
      key: 'is_active', label: 'Active', defaultWidth: 100,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }],
      getValue: (p) => p.is_active ? 'Active' : 'Inactive',
    },
    {
      key: 'actions', label: 'Actions', defaultWidth: 130,
      sortable: false, filterable: false, resizable: false,
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

  const { rows: liveRows, totalCount: liveTotalCount, loading, error } = useDataTableQuery<PromoCodeListRow>({
    tableKey: 'promo_codes',
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
        <p className="text-sm font-medium text-gray-900">No promo codes yet</p>
        <p className="mt-1 text-sm text-gray-500">Add your first promo code to get started.</p>
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
          placeholder="Search by name or code..."
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
            {search ? `No promo codes match "${search}"` : 'No promo codes match the current filters.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {liveRows.map((p) => (
              <PromoCodeCard key={p.id} promo={p} orgSlug={orgSlug} />
            ))}
          </div>
          <div className="mt-3 text-xs text-qm-gray">
            {liveTotalCount === 0
              ? '0 promo codes'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()} promo codes`}
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
              {liveRows.map((p) => {
                const editHref = `/dashboard/${orgSlug}/settings/promo-codes/${p.id}`
                // Delete requires the code to already be deactivated. No
                // linked-record check yet -- promo codes aren't wired into
                // any checkout flow, so there's no redemption/usage table to
                // check against. Revisit once real redemption tracking
                // exists, matching every other section's convention.
                const canDelete = !p.is_active
                const deleteBlockedReason = 'Deactivate this promo code first before it can be deleted.'
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 truncate text-sm font-medium text-gray-900 hover:text-qm-fuchsia">
                        {p.name}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 text-sm font-mono text-gray-700">{p.code}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 text-sm text-gray-600">{p.discount_type ?? '—'}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 text-sm text-gray-900 tabular-nums">
                        {p.discount_type === 'Percentage' ? `${p.value ?? 0}%` : (p.value ?? '—')}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 text-sm text-gray-600 tabular-nums">{fmtMoney(p.minimum_requirement)}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 text-sm text-gray-600 tabular-nums">
                        {p.limit_of_using ? p.limit_of_using : 'Unlimited'}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 text-sm text-gray-600">{fmtDate(p.valid_from)}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={editHref} className="block px-4 py-3 text-sm text-gray-600">{fmtDate(p.valid_to)}</Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={editHref} className="block">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${p.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {p.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </Link>
                    </td>
                    <td className={`px-4 py-3 text-right whitespace-nowrap ${STICKY_ACTIONS_TD}`}>
                      <div className="flex items-center justify-end gap-3">
                        <Link href={editHref} className="text-sm text-qm-lime hover:underline">
                          Edit
                        </Link>
                        {canDelete ? (
                          <form action={deletePromoCode} className="inline">
                            <input type="hidden" name="id" value={p.id} />
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
                ? '0 promo codes'
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
