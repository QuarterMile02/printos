'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { ColumnDef, FilterRule } from '@/components/data-table/types'
import { useSavedView } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { InvoiceCard } from './invoice-card'
import { searchInvoices } from './actions'
import {
  formatInvNumber,
  formatCents,
  INV_STATUS_STYLES,
  INV_STATUS_LABELS,
  INV_STATUS_OPTIONS,
  INV_FILTER_TABS,
} from './format'
import { INVOICES_PAGE_SIZE } from './constants'

// ── Row type ──────────────────────────────────────────────────────────────────

export type InvoiceListRow = {
  id: string
  invoice_number: number
  status: string
  total: number
  balance_due: number
  due_date: string | null
  created_at: string
  customer_id: string | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_SELECT = 'id, invoice_number, status, total, balance_due, due_date, created_at, customer_id, customers(first_name, last_name, company_name)'
const PAGE_SIZE = INVOICES_PAGE_SIZE

// Stable reference — prevents useDataTableQuery from re-running when
// useSavedView's sortRules is empty (no saved view loaded yet).
const DEFAULT_SORT = [{ column: 'invoice_number', direction: 'desc' as const }]

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDueDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCreatedDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Dash() {
  return <span className="text-gray-300">—</span>
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: InvoiceListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
  // Present only when the page was reached via the dashboard's "Overdue
  // Invoices Aging" widget deep link (?overdue_bucket=…). initialRows/
  // initialTotalCount already reflect this special filter (status NOT IN
  // paid/draft/void + due_date range) — a query fetchDataTablePage's generic
  // FilterRule grammar can't express, so it's computed once server-side.
  // The moment the user changes any filter/sort/search/page, the live query
  // takes over and this constraint is no longer applied — the badge below
  // hides itself once that happens.
  initialBucket?: { key: string; label: string }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoicesListClient({
  initialRows,
  initialTotalCount,
  orgSlug,
  orgId,
  userId,
  userRole,
  initialBucket,
}: Props) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusTab, setStatusTab] = useState<'all' | string>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'warn' | 'error' | 'info' } | null>(null)

  function showToast(msg: string, type: 'warn' | 'error' | 'info' = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

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
  } = useSavedView({ tableKey: 'invoices', orgId, userId, userRole })

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  // The status tab acts as an override: strip any status rules from the
  // saved-view filterRules and inject the tab's constraint. When "All" is
  // active, pass filterRules through unchanged.
  const effectiveFilterRules = useMemo((): FilterRule[] => {
    if (statusTab === 'all') return filterRules
    const base = filterRules.filter((r) => r.column !== 'status')
    return [...base, { id: '__status_tab__', column: 'status', operator: 'equals' as const, value: statusTab }]
  }, [filterRules, statusTab])

  // The aging-bucket deep link is a snapshot, not a persistent filter mode —
  // it stays visible only while the view is otherwise untouched.
  const bucketActive = initialBucket && statusTab === 'all' && filterRules.length === 0 && page === 1 && !search

  // ── Column definitions ────────────────────────────────────────────────────
  const COLUMNS = useMemo((): ColumnDef<InvoiceListRow>[] => [
    {
      key: 'invoice_number', label: 'Invoice #', defaultWidth: 130,
      sortable: true, filterable: false,
      getValue: (r) => formatInvNumber(r.invoice_number, r.created_at),
    },
    {
      key: 'customer', label: 'Customer', defaultWidth: 220,
      sortable: false, filterable: false,
      getValue: (r) => r.customers
        ? (r.customers.company_name ?? [r.customers.first_name, r.customers.last_name].filter(Boolean).join(' '))
        : null,
    },
    {
      key: 'total', label: 'Total', defaultWidth: 110,
      sortable: true, filterable: false,
      getValue: (r) => formatCents(r.total),
    },
    {
      key: 'balance_due', label: 'Balance Due', defaultWidth: 120,
      sortable: true, filterable: false,
      getValue: (r) => formatCents(r.balance_due),
    },
    {
      key: 'status', label: 'Status', defaultWidth: 140,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: INV_STATUS_OPTIONS,
      getValue: (r) => r.status,
    },
    {
      key: 'due_date', label: 'Due', defaultWidth: 120,
      sortable: true, filterable: false,
      getValue: (r) => r.due_date,
    },
    {
      key: 'created_at', label: 'Created', defaultWidth: 120,
      sortable: true, filterable: false,
      getValue: (r) => r.created_at,
    },
  ], [])

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

  // Search spans customer name (nested), invoice number, and total (typed as
  // a dollar amount) — fetchDataTablePage's plain ILIKE-across-searchColumns
  // grammar can't express a nested-column ILIKE alongside a cents-converted
  // numeric equals in one call, so this uses useDataTableQuery's searchFn
  // extension point (a real server-side query via a server action) instead
  // of the built-in searchColumns path Quotes/Sales Orders use.
  const boundSearchFn = useCallback((term: string) => searchInvoices(orgId, term), [orgId])

  const { rows: liveRows, totalCount: liveTotalCount, loading } = useDataTableQuery<InvoiceListRow>({
    tableKey: 'invoices',
    orgId,
    select: DB_SELECT,
    filterRules: effectiveFilterRules,
    sortRules: activeSortRules,
    search,
    searchFn: boundSearchFn,
    page,
    pageSize: PAGE_SIZE,
    initialRows,
    initialTotalCount,
  })

  // Reset to page 1 when filter / sort / tab changes
  useEffect(() => { setPage(1) }, [filterRules, sortRules, statusTab])

  // ── Bulk QB export (List mode only — mirrors the pre-existing feature) ───
  const allSelected = liveRows.length > 0 && selected.size === liveRows.length
  const toggleAll = useCallback(() => {
    setSelected((prev) => (prev.size === liveRows.length ? new Set() : new Set(liveRows.map((r) => r.id))))
  }, [liveRows])
  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function handleBulkExport() {
    const ids = Array.from(selected)
    const draftIds = liveRows.filter((r) => ids.includes(r.id) && r.status === 'draft').map((r) => r.id)
    if (draftIds.length > 0) {
      showToast(`${draftIds.length} selected invoice${draftIds.length === 1 ? ' is' : 's are'} still Draft — they will be included in the export.`, 'warn')
    }
    setExporting(true)
    try {
      const res = await fetch('/api/invoices/export-iif-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: ids, organizationId: orgId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast((data as { error?: string }).error ?? 'Export failed', 'error')
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : 'bulk-export.iif'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setSelected(new Set())
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error')
    } finally {
      setExporting(false)
    }
  }

  const toastColors = {
    info: 'bg-green-50 border-green-200 text-green-800',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
    error: 'bg-red-50 border-red-200 text-red-800',
  }

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

  // ── Empty state (org has zero invoices) ──────────────────────────────────
  if (initialRows.length === 0 && statusTab === 'all' && filterRules.length === 0 && !initialBucket && !search && !loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-qm-lime-light text-qm-lime-dark">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 14.25l6-6m4.5-3.493V21.75l-3.75-1.5-3.75 1.5-3.75-1.5-3.75 1.5V4.757c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0c1.1.128 1.907 1.077 1.907 2.185ZM9.75 9h.008v.008H9.75V9Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM14.25 9h.008v.008h-.008V9Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-gray-900">No invoices yet</p>
        <p className="mt-1 text-sm text-gray-500">Invoices are created when a Sales Order is completed.</p>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg ${toastColors[toast.type]}`}>
          {toast.msg}
        </div>
      )}

      {/* Aging-bucket deep-link badge */}
      {bucketActive && initialBucket && (
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-qm-fuchsia/10 px-3 py-1 text-xs font-semibold text-qm-fuchsia">
            Overdue {initialBucket.label}
            <Link href={`/dashboard/${orgSlug}/invoices`} className="text-[#888] hover:text-qm-fuchsia">×</Link>
          </span>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {INV_FILTER_TABS.map((t) => (
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

      {/* Search + Bulk export + Filters/Views toolbar */}
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
            placeholder="Search customer, invoice #, or total…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>

        {selected.size > 0 && (
          <button
            onClick={handleBulkExport}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
          >
            {exporting ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
            )}
            Export to QuickBooks ({selected.size})
          </button>
        )}

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
      {liveRows.length === 0 && !loading ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-gray-500">
            {search
              ? `No invoices match "${search}"`
              : statusTab !== 'all'
                ? `No ${INV_STATUS_LABELS[statusTab] ?? statusTab} invoices.`
                : 'No invoices match the current filters.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <div className={`transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {liveRows.map((inv) => (
              <InvoiceCard key={inv.id} invoice={inv} orgSlug={orgSlug} />
            ))}
          </div>
          <div className="mt-3 text-xs text-qm-gray">
            {liveTotalCount === 0
              ? '0 invoices'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()} invoices`}
          </div>
        </div>
      ) : (
        <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <table
            className="divide-y divide-gray-200 table-fixed"
            style={{ width: totalWidth + 40 + 60, minWidth: '100%' }}
          >
            <colgroup>
              <col style={{ width: 40 }} />
              {COLUMNS.map((col) => (
                <col key={col.key} style={{ width: colWidths[col.key] ?? col.defaultWidth }} />
              ))}
              <col style={{ width: 60 }} />
            </colgroup>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 accent-green-600 cursor-pointer"
                    title="Select all"
                  />
                </th>
                {COLUMNS.map((col, i) => {
                  const isSortable = col.sortable && !isViewReadOnly
                  const isLast = i === COLUMNS.length - 1
                  const isRight = col.key === 'total' || col.key === 'balance_due'
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
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {liveRows.map((inv) => {
                const href = `/dashboard/${orgSlug}/invoices/${inv.id}`
                const dueLabel = formatDueDate(inv.due_date)
                return (
                  <tr key={inv.id} className={`hover:bg-gray-50 ${selected.has(inv.id) ? 'bg-green-50/40' : ''}`}>

                    {/* Checkbox */}
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(inv.id)}
                        onChange={() => toggleOne(inv.id)}
                        className="h-4 w-4 rounded border-gray-300 accent-green-600 cursor-pointer"
                      />
                    </td>

                    {/* # */}
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm font-medium text-qm-fuchsia">
                        {formatInvNumber(inv.invoice_number, inv.created_at)}
                      </Link>
                    </td>

                    {/* Customer */}
                    <td className="overflow-hidden">
                      <Link href={href} className="block px-4 py-3 min-w-0">
                        {inv.customers ? (
                          <>
                            <div className="truncate text-sm font-medium text-gray-900">
                              {inv.customers.company_name || [inv.customers.first_name, inv.customers.last_name].filter(Boolean).join(' ')}
                            </div>
                            {inv.customers.company_name && (
                              <div className="truncate text-xs text-gray-500">
                                {[inv.customers.first_name, inv.customers.last_name].filter(Boolean).join(' ')}
                              </div>
                            )}
                          </>
                        ) : <Dash />}
                      </Link>
                    </td>

                    {/* Total */}
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-right font-medium text-gray-900">
                        ${formatCents(inv.total)}
                      </Link>
                    </td>

                    {/* Balance Due */}
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-right font-medium">
                        <span className={inv.balance_due > 0 ? 'text-red-600' : 'text-green-600'}>
                          ${formatCents(inv.balance_due)}
                        </span>
                      </Link>
                    </td>

                    {/* Status */}
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link href={href} className="block">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${INV_STATUS_STYLES[inv.status] ?? 'bg-gray-100 text-gray-700'}`}>
                          {INV_STATUS_LABELS[inv.status] ?? inv.status}
                        </span>
                      </Link>
                    </td>

                    {/* Due */}
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-500">
                        {dueLabel ?? <Dash />}
                      </Link>
                    </td>

                    {/* Created */}
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-500">
                        {formatCreatedDate(inv.created_at)}
                      </Link>
                    </td>

                    {/* Actions — QB export */}
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <a
                        href={`/api/invoices/${inv.id}/export-iif`}
                        className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline"
                        title="Export to QuickBooks"
                      >
                        QB
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Pagination footer */}
          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-3 text-sm text-gray-500">
            <span>
              {liveTotalCount === 0
                ? '0 invoices'
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
