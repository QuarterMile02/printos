'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import type { ColumnDef, FilterRule } from '@/components/data-table/types'
import { useSavedView } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { QuoteCard } from './quote-card'
import {
  formatQuoteNumber,
  formatCents,
  QUOTE_STATUS_STYLES,
  QUOTE_STATUS_LABELS,
  QUOTE_STATUS_OPTIONS,
  QUOTE_FILTER_TABS,
} from './format'
import { QUOTES_PAGE_SIZE } from './constants'
import type { QuoteStatus } from '@/types/database'

// ── Row type ──────────────────────────────────────────────────────────────────

export type QuoteListRow = {
  id: string
  quote_number: number
  title: string
  status: QuoteStatus
  created_at: string
  total: number | null
  customer_id: string | null
  customers: {
    first_name: string
    last_name: string
    company_name: string | null
  } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_SELECT = 'id, quote_number, title, status, created_at, total, customer_id, customers(first_name, last_name, company_name)'
const PAGE_SIZE = QUOTES_PAGE_SIZE

// Stable reference — prevents useDataTableQuery from re-running when
// useSavedView's sortRules is empty (no saved view loaded yet).
const DEFAULT_SORT = [{ column: 'quote_number', direction: 'desc' as const }]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Dash() {
  return <span className="text-gray-300">—</span>
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: QuoteListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
  canSeePricing: boolean
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuotesListClient({
  initialRows,
  initialTotalCount,
  orgSlug,
  orgId,
  userId,
  userRole,
  canSeePricing,
}: Props) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusTab, setStatusTab] = useState<'all' | QuoteStatus>('all')

  // ── Saved-views hook ──────────────────────────────────────────────────────
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
  } = useSavedView({ tableKey: 'quotes', orgId, userId, userRole })

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  // The status tab acts as an override: strip any status rules from the
  // saved-view filterRules and inject the tab's constraint. When "All" is
  // active, pass filterRules through unchanged (saved-view status rules apply).
  const effectiveFilterRules = useMemo((): FilterRule[] => {
    if (statusTab === 'all') return filterRules
    const base = filterRules.filter((r) => r.column !== 'status')
    return [...base, { id: '__status_tab__', column: 'status', operator: 'equals' as const, value: statusTab }]
  }, [filterRules, statusTab])

  // ── Column definitions ────────────────────────────────────────────────────
  const COLUMNS = useMemo((): ColumnDef<QuoteListRow>[] => {
    const cols: ColumnDef<QuoteListRow>[] = [
      {
        key: 'quote_number', label: 'Quote #', defaultWidth: 130,
        sortable: true, filterable: false,
        getValue: (r) => formatQuoteNumber(r.quote_number, r.created_at),
      },
      {
        key: 'title', label: 'Title', defaultWidth: 260,
        sortable: true, filterable: true, filterType: 'text',
        getValue: (r) => r.title,
      },
      {
        key: 'customer', label: 'Customer', defaultWidth: 210,
        sortable: false, filterable: false,
        getValue: (r) => r.customers
          ? (r.customers.company_name ?? [r.customers.first_name, r.customers.last_name].filter(Boolean).join(' '))
          : null,
      },
    ]
    if (canSeePricing) {
      cols.push({
        key: 'total', label: 'Total', defaultWidth: 110,
        sortable: true, filterable: false,
        getValue: (r) => r.total != null ? formatCents(r.total) : null,
      })
    }
    cols.push(
      {
        key: 'status', label: 'Status', defaultWidth: 160,
        sortable: true, filterable: true, filterType: 'select',
        filterOptions: QUOTE_STATUS_OPTIONS.map((o) => ({ label: o.label, value: o.value })),
        getValue: (r) => r.status,
      },
      {
        key: 'created_at', label: 'Created', defaultWidth: 120,
        sortable: true, filterable: false,
        getValue: (r) => r.created_at,
      },
    )
    return cols
  }, [canSeePricing])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  // ── Column resize ─────────────────────────────────────────────────────────
  const { widths: colWidths, startResize } = useColumnResize({
    defaultWidths,
    savedWidths,
    onWidthCommit: setColumnWidth,
    disabled: isViewReadOnly,
  })

  // ── Live query ────────────────────────────────────────────────────────────
  const { rows: liveRows, totalCount: liveTotalCount, loading } = useDataTableQuery<QuoteListRow>({
    tableKey: 'quotes',
    orgId,
    select: DB_SELECT,
    filterRules: effectiveFilterRules,
    sortRules: activeSortRules,
    search,
    searchColumns: ['title'],
    page,
    pageSize: PAGE_SIZE,
    initialRows,
    initialTotalCount,
  })

  // Reset to page 1 when filter / sort / tab / search changes
  useEffect(() => { setPage(1) }, [filterRules, sortRules, statusTab])

  // ── Sort indicator ────────────────────────────────────────────────────────
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

  // ── Empty state (org has zero quotes) ────────────────────────────────────
  if (initialRows.length === 0 && statusTab === 'all' && filterRules.length === 0 && !search && !loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-qm-lime-light text-qm-lime-dark">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-gray-900">No quotes yet</p>
        <p className="mt-1 text-sm text-gray-500">Create your first quote to send to a customer.</p>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Status tabs ── */}
      <div className="flex gap-1 border-b border-gray-200">
        {QUOTE_FILTER_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => { setStatusTab(t.value); setPage(1) }}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              statusTab === t.value
                ? 'border-qm-lime text-qm-lime'
                : 'border-transparent text-qm-gray hover:text-qm-black'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Search + Filters/Views toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Search */}
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
            placeholder="Search title…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
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

      {/* ── Card grid / Table ── */}
      {liveRows.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-gray-500">
            {search
              ? `No quotes match "${search}"`
              : statusTab !== 'all'
                ? `No ${QUOTE_STATUS_LABELS[statusTab] ?? statusTab} quotes.`
                : 'No quotes match the current filters.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {liveRows.map((q) => (
              <QuoteCard key={q.id} quote={q} orgSlug={orgSlug} canSeePricing={canSeePricing} />
            ))}
          </div>
          <div className="mt-3 text-xs text-qm-gray">
            {liveTotalCount === 0
              ? '0 quotes'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()} quotes`}
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
                  const isRight = col.key === 'total'
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
              {liveRows.map((quote) => {
                const href = `/dashboard/${orgSlug}/quotes/${quote.id}`
                return (
                  <tr key={quote.id} className="hover:bg-gray-50">

                    {/* # — formatted quote number */}
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm font-medium text-qm-fuchsia">
                        {formatQuoteNumber(quote.quote_number, quote.created_at)}
                      </Link>
                    </td>

                    {/* Title */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block truncate px-4 py-3 text-sm font-medium text-gray-900" title={quote.title}>
                        {quote.title || <Dash />}
                      </Link>
                    </td>

                    {/* Customer — company name, contact name as subtitle */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block px-4 py-3 min-w-0">
                        {quote.customers ? (
                          <>
                            <div className="truncate text-sm font-medium text-gray-900">
                              {quote.customers.company_name || [quote.customers.first_name, quote.customers.last_name].filter(Boolean).join(' ')}
                            </div>
                            {quote.customers.company_name && (
                              <div className="truncate text-xs text-gray-500">
                                {[quote.customers.first_name, quote.customers.last_name].filter(Boolean).join(' ')}
                              </div>
                            )}
                          </>
                        ) : <Dash />}
                      </Link>
                    </td>

                    {/* Total (conditional) */}
                    {canSeePricing && (
                      <td className="whitespace-nowrap overflow-hidden">
                        <Link href={href} className="block px-4 py-3 text-sm text-right font-medium text-gray-900">
                          {quote.total != null ? `$${formatCents(quote.total)}` : <Dash />}
                        </Link>
                      </td>
                    )}

                    {/* Status */}
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={href} className="block">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${QUOTE_STATUS_STYLES[quote.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {QUOTE_STATUS_LABELS[quote.status] ?? quote.status}
                        </span>
                      </Link>
                    </td>

                    {/* Created */}
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-500">
                        {formatDate(quote.created_at)}
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* ── Pagination footer ── */}
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-3 text-sm text-gray-500">
            <span>
              {liveTotalCount === 0
                ? '0 quotes'
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
          </div>
        </div>
      )}
    </div>
  )
}
