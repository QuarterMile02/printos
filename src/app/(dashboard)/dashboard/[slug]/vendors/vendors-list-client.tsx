'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { searchVendors, type VendorListRow } from './actions'
import { createClient } from '@/lib/supabase/client'
import type { ColumnDef, FilterRule } from '@/components/data-table/types'
import { useSavedView, applySortRules } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { DataTableError } from '@/components/data-table/data-table-error'
import { VendorCard } from './vendor-card'
import { VENDORS_PAGE_SIZE } from './constants'

// ── Constants ────────────────────────────────────────────────────────────────

const DB_SELECT = 'id, name, primary_contact, primary_phone, primary_email, city, state, is_active, created_at'
const PAGE_SIZE = VENDORS_PAGE_SIZE

type StatusTab = 'all' | 'enabled' | 'disabled'

// ── Helpers ──────────────────────────────────────────────────────────────────

function Dash() {
  return <span className="text-gray-300">—</span>
}

function tabToActiveOnly(tab: StatusTab): boolean | undefined {
  if (tab === 'enabled') return true
  if (tab === 'disabled') return false
  return undefined
}

// ── Props ────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: VendorListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function VendorsListClient({
  initialRows,
  initialTotalCount,
  orgSlug,
  orgId,
  userId,
  userRole,
}: Props) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)

  // Search mode: when active, useDataTableQuery is bypassed and searchResults holds the data.
  // Preserves the existing searchVendors RPC (fuzzy + ILIKE fallback) exactly as-is —
  // same split as Customers between browse-mode (useDataTableQuery) and search-mode.
  const [searchResults, setSearchResults] = useState<VendorListRow[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  // ── Saved-views hook ─────────────────────────────────────────────────────
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
  } = useSavedView({ tableKey: 'vendors', orgId, userId, userRole })

  // Status quick-filter tab, independent of the saved-view Filters panel —
  // same pattern as Customers: tab overrides any is_active rule in filterRules.
  const [tab, setTab] = useState<StatusTab>('all')
  const [tabCounts, setTabCounts] = useState({ all: initialTotalCount, enabled: 0, disabled: 0 })

  useEffect(() => {
    let cancelled = false
    const client = createClient()
    Promise.all([
      client.from('vendors').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
      client.from('vendors').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', true),
      client.from('vendors').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('is_active', false),
    ]).then(([all, enabled, disabled]) => {
      if (cancelled) return
      setTabCounts({ all: all.count ?? 0, enabled: enabled.count ?? 0, disabled: disabled.count ?? 0 })
    })
    return () => { cancelled = true }
  }, [orgId])

  const effectiveFilterRules = useMemo((): FilterRule[] => {
    const base = filterRules.filter((r) => r.column !== 'is_active')
    if (tab === 'all') return base
    return [...base, { id: '__status_tab__', column: 'is_active', operator: 'equals' as const, value: tab === 'enabled' ? 'true' : 'false' }]
  }, [filterRules, tab])

  // ── Column definitions ───────────────────────────────────────────────────
  // Company shows the company name only — deliberately NOT a contact-name
  // subtitle, since Contact already has its own column right next to it;
  // doubling it up here would just repeat the same value twice in one row.
  const COLUMNS = useMemo((): ColumnDef<VendorListRow>[] => [
    {
      key: 'name', label: 'Company', defaultWidth: 220,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => r.name,
    },
    {
      key: 'primary_contact', label: 'Contact', defaultWidth: 170,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => r.primary_contact,
    },
    {
      key: 'primary_phone', label: 'Phone', defaultWidth: 140,
      sortable: false, filterable: false,
    },
    {
      key: 'primary_email', label: 'Email', defaultWidth: 200,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => r.primary_email,
    },
    {
      key: 'city_state', label: 'City / State', defaultWidth: 150,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => [r.city, r.state].filter(Boolean).join(', ') || null,
    },
  ], [])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  // ── Column resize ────────────────────────────────────────────────────────
  const { widths: colWidths, startResize } = useColumnResize({
    defaultWidths,
    savedWidths,
    onWidthCommit: setColumnWidth,
    disabled: isViewReadOnly,
  })

  // ── Live query (browse mode — bypassed when searchResults is active) ─────
  const { rows: liveRows, totalCount: liveTotalCount, loading, error } = useDataTableQuery<VendorListRow>({
    tableKey: 'vendors',
    orgId,
    select: DB_SELECT,
    filterRules: effectiveFilterRules,
    sortRules,
    search: '',          // search is handled separately via searchVendors RPC
    page,
    pageSize: PAGE_SIZE,
    initialRows,
    initialTotalCount,
  })

  // Reset page when filter/sort rules change
  useEffect(() => { setPage(1) }, [filterRules, sortRules, tab])

  // ── Search (fuzzy RPC — preserves existing searchVendors behaviour) ──────
  function handleSearchChange(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const term = value.trim()
    if (term.length < 2) {
      setSearchResults(null)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const seq = ++searchSeqRef.current
    debounceRef.current = setTimeout(async () => {
      const results = await searchVendors(orgId, term, tabToActiveOnly(tab))
      if (searchSeqRef.current === seq) {
        setSearchResults(results)
        setIsSearching(false)
      }
    }, 300)
  }

  // ── Display data ─────────────────────────────────────────────────────────
  const displayRows = useMemo(() => {
    if (searchResults !== null) {
      return sortRules.length > 0 ? applySortRules(searchResults, sortRules, COLUMNS) : searchResults
    }
    return liveRows
  }, [searchResults, liveRows, sortRules, COLUMNS])

  const totalPages = Math.max(1, Math.ceil(liveTotalCount / PAGE_SIZE))

  // ── Sort indicator helper ─────────────────────────────────────────────────
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

  // ── Empty state (no vendors at all) ─────────────────────────────────────
  if (initialRows.length === 0 && !loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-qm-lime-light text-qm-lime-dark">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349M3.75 21V9.349m0 0a3.001 3.001 0 0 0 3.75-.615A2.993 2.993 0 0 0 9.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 0 0 2.25 1.016c.896 0 1.7-.393 2.25-1.016a3.001 3.001 0 0 0 3.75.614m-16.5 0a3.004 3.004 0 0 1-.621-4.72L4.318 3.44A1.5 1.5 0 0 1 5.378 3h13.243a1.5 1.5 0 0 1 1.06.44l1.19 1.189a3 3 0 0 1-.621 4.72" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-gray-900">No vendors yet</p>
        <p className="mt-1 text-sm text-gray-500">Add your first vendor to start tracking materials and purchase orders.</p>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
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

      {/* ── Toolbar ── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">

        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          {isSearching ? (
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
            placeholder="Search name, contact, email, city…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>

        {/* Filters + Views toolbar (portaled — no overflow clip risk) */}
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

      {/* ── Card / Table ── */}
      {error && searchResults === null ? (
        <DataTableError />
      ) : displayRows.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-qm-gray">
            {search ? `No vendors match "${search}"` : 'No vendors match the current filters.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {displayRows.map((v) => (
              <VendorCard key={v.id} v={v} orgSlug={orgSlug} />
            ))}
          </div>
          <div className="mt-3 text-xs text-qm-gray">
            {searchResults !== null
              ? (searchResults.length === 50
                ? 'Showing top 50 matches — refine your search for more specific results.'
                : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} from database`)
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()} vendors`}
          </div>
        </div>
      ) : (
        <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <table
            className="divide-y divide-gray-200 table-fixed"
            style={{ width: totalWidth, minWidth: '100%' }}
          >
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
                  return (
                    <th
                      key={col.key}
                      onClick={isSortable ? () => setSort(col.key) : undefined}
                      className={`relative px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${isSortable ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                    >
                      <div className="flex items-center gap-1">
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
              {displayRows.map((v) => {
                const href = `/dashboard/${orgSlug}/vendors/${v.id}`
                const cityState = [v.city, v.state].filter(Boolean).join(', ')
                const isInactive = v.is_active === false
                return (
                  <tr key={v.id} className={`hover:bg-gray-50 ${isInactive ? 'opacity-60' : ''}`}>

                    {/* Company — name only, no contact subtitle (Contact has its own column) */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm font-semibold text-qm-black" title={v.name ?? undefined}>
                        {v.name}
                      </Link>
                    </td>

                    {/* Contact */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm text-gray-700">
                        {v.primary_contact ?? <Dash />}
                      </Link>
                    </td>

                    {/* Phone */}
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {v.primary_phone
                        ? <a href={`tel:${v.primary_phone}`} className="hover:underline">{v.primary_phone}</a>
                        : <Dash />}
                    </td>

                    {/* Email */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm text-gray-500">
                        {v.primary_email ?? <Dash />}
                      </Link>
                    </td>

                    {/* City / State */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm text-gray-500">
                        {cityState || <Dash />}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* ── Footer: pagination (browse) or search result count ── */}
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-3 text-sm text-qm-gray">
            {searchResults !== null ? (
              <span>
                {searchResults.length === 50
                  ? 'Showing top 50 matches — refine your search for more specific results.'
                  : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} from database`}
              </span>
            ) : (
              <>
                <span>
                  {liveTotalCount === 0
                    ? '0 vendors'
                    : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()}`}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(1)}
                      disabled={page === 1}
                      className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >«</button>
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >‹ Prev</button>
                    <span className="px-2 text-xs font-medium">Page {page} of {totalPages}</span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >Next ›</button>
                    <button
                      onClick={() => setPage(totalPages)}
                      disabled={page === totalPages}
                      className="rounded px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                    >»</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
