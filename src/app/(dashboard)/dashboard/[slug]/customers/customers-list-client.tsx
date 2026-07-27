'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import Link from 'next/link'
import { searchCustomers, type CustomerListRow } from './actions'
import type { ColumnDef } from '@/components/data-table/types'
import { useSavedView, applySortRules } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  lead:     'bg-gray-100 text-gray-700',
  sold:     'bg-qm-lime-light text-qm-lime-dark',
  closable: 'bg-blue-50 text-blue-700',
  prospect: 'bg-yellow-50 text-yellow-700',
}
const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', sold: 'Sold', closable: 'Closable', prospect: 'Prospect',
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'closable', label: 'Closable' },
  { value: 'sold', label: 'Sold' },
  { value: 'inactive', label: 'Disabled' },
]
const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'company', label: 'Company' },
  { value: 'individual', label: 'Individual' },
]
const SORT_LABELS: Record<string, string> = {
  name_asc:  'Name A→Z',
  name_desc: 'Name Z→A',
  newest:    'Newest First',
}
const SORT_CYCLE: Record<string, string> = {
  name_asc:  'name_desc',
  name_desc: 'newest',
  newest:    'name_asc',
}

const DB_SELECT = 'id, first_name, last_name, company_name, email, phone, city, state, status, terms, is_active, tags, created_at'
const PAGE_SIZE = 25

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildUrl(orgSlug: string, params: { sort?: string; status?: string; type?: string; tag?: string }) {
  const sp = new URLSearchParams()
  if (params.sort && params.sort !== 'name_asc') sp.set('sort', params.sort)
  if (params.status) sp.set('status', params.status)
  if (params.type)   sp.set('type', params.type)
  if (params.tag)    sp.set('tag', params.tag)
  const q = sp.toString()
  return `/dashboard/${orgSlug}/customers${q ? `?${q}` : ''}`
}

function Dash() {
  return <span className="text-gray-300">—</span>
}

// ── Props ────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: CustomerListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
  distinctTags: string[]
  sort: string
  statusFilter: string
  typeFilter: string
  tagFilter: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CustomersListClient({
  initialRows,
  initialTotalCount,
  orgSlug,
  orgId,
  userId,
  userRole,
  distinctTags,
  sort,
  statusFilter,
  typeFilter,
  tagFilter,
}: Props) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)

  // Search mode: when active, useDataTableQuery is bypassed and searchResults holds the data.
  // This preserves the existing searchCustomers RPC (fuzzy + ILIKE fallback) exactly as-is.
  const [searchResults, setSearchResults] = useState<CustomerListRow[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)

  const hasFilters = !!(statusFilter || typeFilter || tagFilter)

  // ── Saved-views hook ─────────────────────────────────────────────────────
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
  } = useSavedView({ tableKey: 'customers', orgId, userId, userRole })

  // ── Column definitions ───────────────────────────────────────────────────
  const COLUMNS = useMemo((): ColumnDef<CustomerListRow>[] => [
    {
      key: 'company_name', label: 'Company', defaultWidth: 220,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => r.company_name,
    },
    {
      key: 'contact', label: 'Primary Contact', defaultWidth: 170,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => [r.first_name, r.last_name].filter(Boolean).join(' '),
    },
    {
      key: 'phone', label: 'Phone', defaultWidth: 140,
      sortable: false, filterable: false,
    },
    {
      key: 'email', label: 'Email', defaultWidth: 200,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => r.email,
    },
    {
      key: 'city_state', label: 'City / State', defaultWidth: 150,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => [r.city, r.state].filter(Boolean).join(', ') || null,
    },
    {
      key: 'status', label: 'Status', defaultWidth: 120,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: [
        { label: 'Lead',     value: 'lead' },
        { label: 'Prospect', value: 'prospect' },
        { label: 'Closable', value: 'closable' },
        { label: 'Sold',     value: 'sold' },
        { label: 'Disabled', value: 'inactive' },
      ],
      getValue: (r) => r.is_active === false ? 'inactive' : (r.status ?? 'lead'),
    },
    {
      key: 'terms', label: 'Terms', defaultWidth: 110,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => r.terms,
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
  const { rows: liveRows, totalCount: liveTotalCount, loading } = useDataTableQuery<CustomerListRow>({
    tableKey: 'customers',
    orgId,
    select: DB_SELECT,
    filterRules,
    sortRules,
    search: '',          // search is handled separately via searchCustomers RPC
    page,
    pageSize: PAGE_SIZE,
    initialRows,
    initialTotalCount,
  })

  // Reset page when filter/sort rules change
  useEffect(() => { setPage(1) }, [filterRules, sortRules])

  // ── Search (fuzzy RPC — preserves existing searchCustomers behaviour) ────
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
      const results = await searchCustomers(orgId, term, {
        status: statusFilter,
        type: typeFilter,
        tag: tagFilter,
      })
      if (searchSeqRef.current === seq) {
        setSearchResults(results)
        setIsSearching(false)
      }
    }, 300)
  }

  // ── Display data ─────────────────────────────────────────────────────────
  // In search mode: show searchResults (fuzzy-ranked, no pagination).
  // In browse mode: show liveRows (server-paginated, sorted by DB).
  // The saved-view sortRules are sent to the DB query; applySortRules is only
  // used here for search results since those come back pre-ranked and may need
  // secondary sort from the saved view.
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

  // ── Empty state (no customers at all) ───────────────────────────────────
  if (initialRows.length === 0 && !hasFilters && !loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-qm-lime-light text-qm-lime-dark">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-gray-900">No customers yet</p>
        <p className="mt-1 text-sm text-gray-500">Add your first customer to start tracking orders.</p>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
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
            placeholder="Search name, company, email, city, phone…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-400 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => { window.location.href = buildUrl(orgSlug, { sort, status: e.target.value, type: typeFilter, tag: tagFilter }) }}
          className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => { window.location.href = buildUrl(orgSlug, { sort, status: statusFilter, type: e.target.value, tag: tagFilter }) }}
          className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Tags filter */}
        {distinctTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => { window.location.href = buildUrl(orgSlug, { sort, status: statusFilter, type: typeFilter, tag: e.target.value }) }}
            className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            <option value="">All Tags</option>
            {distinctTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        )}

        {/* Sort toggle */}
        <a
          href={buildUrl(orgSlug, { sort: SORT_CYCLE[sort] ?? 'name_asc', status: statusFilter, type: typeFilter, tag: tagFilter })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
          </svg>
          {SORT_LABELS[sort] ?? 'Sort'}
        </a>

        {/* Clear filters */}
        {hasFilters && (
          <a
            href={buildUrl(orgSlug, { sort })}
            className="text-sm text-qm-fuchsia hover:underline"
          >
            Clear filters
          </a>
        )}

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
          />
        </div>
      </div>

      {/* Active filter badges */}
      {hasFilters && (
        <div className="flex flex-wrap gap-2">
          {statusFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Status: {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter}
              <a href={buildUrl(orgSlug, { sort, type: typeFilter, tag: tagFilter })} className="ml-1 hover:text-qm-fuchsia">×</a>
            </span>
          )}
          {typeFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Type: {TYPE_OPTIONS.find((o) => o.value === typeFilter)?.label ?? typeFilter}
              <a href={buildUrl(orgSlug, { sort, status: statusFilter, tag: tagFilter })} className="ml-1 hover:text-qm-fuchsia">×</a>
            </span>
          )}
          {tagFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Tag: {tagFilter}
              <a href={buildUrl(orgSlug, { sort, status: statusFilter, type: typeFilter })} className="ml-1 hover:text-qm-fuchsia">×</a>
            </span>
          )}
        </div>
      )}

      {/* ── Table ── */}
      {displayRows.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-qm-gray">
            {search ? `No customers match "${search}"` : 'No customers match the current filters.'}
          </p>
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
              {displayRows.map((c) => {
                const href = `/dashboard/${orgSlug}/customers/${c.id}`
                const cityState = [c.city, c.state].filter(Boolean).join(', ')
                const isInactive = c.is_active === false
                const status = c.status ?? 'lead'
                return (
                  <tr key={c.id} className={`hover:bg-gray-50 ${isInactive ? 'opacity-60' : ''}`}>

                    {/* Company — bold primary, contact name as subtitle */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block px-4 py-3 min-w-0">
                        <div className="truncate text-sm font-semibold text-qm-black" title={c.company_name ?? undefined}>
                          {c.company_name ?? <span className="font-normal text-gray-400">—</span>}
                        </div>
                        {(c.first_name || c.last_name) && (
                          <div className="truncate text-xs text-qm-gray">
                            {[c.first_name, c.last_name].filter(Boolean).join(' ')}
                          </div>
                        )}
                      </Link>
                    </td>

                    {/* Primary Contact */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm text-gray-700">
                        {[c.first_name, c.last_name].filter(Boolean).join(' ') || <Dash />}
                      </Link>
                    </td>

                    {/* Phone */}
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {c.phone
                        ? <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a>
                        : <Dash />}
                    </td>

                    {/* Email */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm text-gray-500">
                        {c.email ?? <Dash />}
                      </Link>
                    </td>

                    {/* City / State */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm text-gray-500">
                        {cityState || <Dash />}
                      </Link>
                    </td>

                    {/* Status */}
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={href} className="block">
                        {isInactive ? (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500">
                            Disabled
                          </span>
                        ) : (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_LABELS[status] ?? status}
                          </span>
                        )}
                      </Link>
                    </td>

                    {/* Terms */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm text-gray-500">
                        {c.terms ?? <Dash />}
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
                    ? '0 customers'
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
