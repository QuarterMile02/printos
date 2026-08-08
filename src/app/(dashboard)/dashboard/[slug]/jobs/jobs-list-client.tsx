'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { ColumnDef } from '@/components/data-table/types'
import { useSavedView } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { DataTableError } from '@/components/data-table/data-table-error'
import { JOBS_DB_SELECT, JOBS_PAGE_SIZE, type JobListRow } from './jobs-list-constants'

export type { JobListRow }

const SEARCH_COLUMNS = ['title']
const DEFAULT_SORT = [{ column: 'job_number', direction: 'desc' as const }]

const FLAG_LABELS: Record<string, string> = { file_error: 'File Error', help_needed: 'Help Needed' }

function daysLeft(dueDate: string | null): number | null {
  if (!dueDate) return null
  const due = new Date(dueDate + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

function formatDaysLeft(n: number | null): { text: string; className: string } {
  if (n === null) return { text: '—', className: 'text-gray-400' }
  if (n < 0) return { text: `${Math.abs(n)}d overdue`, className: 'text-red-600 font-semibold' }
  if (n === 0) return { text: 'Due today', className: 'text-amber-600 font-semibold' }
  if (n <= 2) return { text: `${n}d left`, className: 'text-amber-600' }
  return { text: `${n}d left`, className: 'text-gray-600' }
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: JobListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
}

export default function JobsListClient({
  initialRows,
  initialTotalCount,
  orgSlug,
  orgId,
  userId,
  userRole,
}: Props) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

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
  } = useSavedView({ tableKey: 'jobs', orgId, userId, userRole })

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  // ── Column definitions — exact order/labels ShopVOX's own live Jobs list
  // uses (per confirmed research), Job # last. Only job_number/title/due_date
  // are real, directly-filterable/sortable jobs columns; the rest are
  // resolved via joins below and shown display-only.
  const COLUMNS = useMemo((): ColumnDef<JobListRow>[] => [
    {
      key: 'title', label: 'Job Title', defaultWidth: 260,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (j) => j.title,
    },
    { key: 'customer', label: 'Customer', defaultWidth: 200, sortable: false, filterable: false },
    { key: 'deposit_pct', label: 'Deposit %', defaultWidth: 100, sortable: false, filterable: false },
    { key: 'so_number', label: 'Sales Order #', defaultWidth: 130, sortable: false, filterable: false },
    { key: 'invoice_number', label: 'Invoice #', defaultWidth: 110, sortable: false, filterable: false },
    {
      key: 'due_date', label: 'Due Date', defaultWidth: 120,
      sortable: true, filterable: false,
      getValue: (j) => j.due_date,
    },
    { key: 'days_left', label: 'Days Left', defaultWidth: 100, sortable: false, filterable: false },
    { key: 'tags', label: 'Tags', defaultWidth: 160, sortable: false, filterable: false },
    {
      key: 'job_number', label: 'Job #', defaultWidth: 90,
      sortable: true, filterable: false,
      getValue: (j) => j.job_number,
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

  const { rows: liveRows, totalCount: liveTotalCount, loading, error } = useDataTableQuery<JobListRow>({
    tableKey: 'jobs',
    orgId,
    select: JOBS_DB_SELECT,
    filterRules,
    sortRules: activeSortRules,
    search,
    searchColumns: SEARCH_COLUMNS,
    page,
    pageSize: JOBS_PAGE_SIZE,
    initialRows,
    initialTotalCount,
  })

  useEffect(() => { setPage(1) }, [filterRules, sortRules])

  // Customer name / Sales Order # / Invoice # / Deposit % aren't columns on
  // `jobs` — resolved per the current page's rows only, same pattern as
  // jobs/page.tsx's kanban fetch (customer names) and discounts-list-client's
  // tier counts.
  type JoinedInfo = {
    customerName: string | null
    depositPct: number | null
    soNumber: number | null
    invoiceNumber: number | null
  }
  const [joined, setJoined] = useState<Record<string, JoinedInfo>>({})
  useEffect(() => {
    if (liveRows.length === 0) { setJoined({}); return }
    let cancelled = false
    const client = createClient()

    const customerIds = [...new Set(liveRows.map((r) => r.customer_id).filter(Boolean) as string[])]
    const soIds = [...new Set(liveRows.map((r) => r.sales_order_id).filter(Boolean) as string[])]
    const invoiceIds = [...new Set(liveRows.map((r) => r.invoice_id).filter(Boolean) as string[])]

    Promise.all([
      customerIds.length > 0
        ? client.from('customers').select('id, first_name, last_name, company_name, terms').in('id', customerIds)
        : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; company_name: string | null; terms: string | null }[] }),
      soIds.length > 0
        ? client.from('sales_orders').select('id, so_number').in('id', soIds)
        : Promise.resolve({ data: [] as { id: string; so_number: number }[] }),
      invoiceIds.length > 0
        ? client.from('invoices').select('id, invoice_number').in('id', invoiceIds)
        : Promise.resolve({ data: [] as { id: string; invoice_number: number }[] }),
    ]).then(async ([custRes, soRes, invRes]) => {
      if (cancelled) return
      const customers = custRes.data ?? []
      const soMap = new Map((soRes.data ?? []).map((s) => [s.id, s.so_number]))
      const invMap = new Map((invRes.data ?? []).map((i) => [i.id, i.invoice_number]))

      // Deposit % — via customer.terms -> term_codes.down_payment_percent
      // (same lookup the Quote PDF already does; no deposit % stored
      // directly anywhere on job/SO/invoice).
      const termNames = [...new Set(customers.map((c) => c.terms).filter(Boolean) as string[])]
      let termMap = new Map<string, number>()
      if (termNames.length > 0) {
        const { data: termRows } = await client
          .from('term_codes')
          .select('name, down_payment_percent')
          .eq('organization_id', orgId)
          .in('name', termNames) as { data: { name: string; down_payment_percent: number | null }[] | null }
        termMap = new Map((termRows ?? []).filter((t) => t.down_payment_percent != null).map((t) => [t.name, t.down_payment_percent as number]))
      }
      const customerById = new Map(customers.map((c) => [c.id, c]))

      const next: Record<string, JoinedInfo> = {}
      for (const r of liveRows) {
        const cust = r.customer_id ? customerById.get(r.customer_id) : undefined
        next[r.id] = {
          customerName: cust ? (cust.company_name?.trim() || `${cust.first_name} ${cust.last_name}`.trim()) : null,
          depositPct: cust?.terms ? (termMap.get(cust.terms) ?? null) : null,
          soNumber: r.sales_order_id ? soMap.get(r.sales_order_id) ?? null : null,
          invoiceNumber: r.invoice_id ? invMap.get(r.invoice_id) ?? null : null,
        }
      }
      if (!cancelled) setJoined(next)
    })
    return () => { cancelled = true }
  }, [liveRows, orgId])

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
  const totalPages = Math.max(1, Math.ceil(liveTotalCount / JOBS_PAGE_SIZE))

  return (
    <div className="space-y-4">
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
            placeholder="Search by job title..."
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
            {search ? `No jobs match "${search}"` : 'No jobs match the current filters.'}
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
              {liveRows.map((j) => {
                const href = `/dashboard/${orgSlug}/jobs/${j.id}`
                const info = joined[j.id]
                const dl = formatDaysLeft(daysLeft(j.due_date))
                return (
                  <tr key={j.id} className="hover:bg-gray-50">
                    <td className="overflow-hidden">
                      <Link href={href} className="block px-4 py-3 min-w-0 truncate text-sm font-medium text-gray-900 hover:text-qm-fuchsia">
                        {j.title}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-700 truncate">{info?.customerName ?? '—'}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-700 tabular-nums">{info?.depositPct != null ? `${info.depositPct}%` : '—'}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-700 tabular-nums">{info?.soNumber != null ? `SO-${String(info.soNumber).padStart(4, '0')}` : '—'}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-700 tabular-nums">{info?.invoiceNumber != null ? `INV-${String(info.invoiceNumber).padStart(4, '0')}` : '—'}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-700">
                        {j.due_date ? new Date(j.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className={`block px-4 py-3 text-sm ${dl.className}`}>{dl.text}</Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {j.department && (
                            <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 capitalize">{j.department.replace(/_/g, ' ')}</span>
                          )}
                          {j.flag && (
                            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${j.flag === 'file_error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                              {FLAG_LABELS[j.flag] ?? j.flag}
                            </span>
                          )}
                          {!j.department && !j.flag && <span className="text-gray-300">—</span>}
                        </div>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap overflow-hidden">
                      <Link href={href} className="block px-4 py-3 text-sm text-gray-500 tabular-nums">{String(j.job_number).padStart(4, '0')}</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-3 text-sm text-gray-500">
            <span>
              {liveTotalCount === 0
                ? '0 jobs'
                : `Showing ${(page - 1) * JOBS_PAGE_SIZE + 1}–${Math.min(page * JOBS_PAGE_SIZE, liveTotalCount)} of ${liveTotalCount.toLocaleString()}`}
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
