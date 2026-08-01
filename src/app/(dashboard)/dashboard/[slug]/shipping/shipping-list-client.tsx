'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@/components/data-table/types'
import { useSavedView } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { useDataTableQuery } from '@/components/data-table/use-data-table-query'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'
import { STICKY_ACTIONS_TH, STICKY_ACTIONS_TD } from '@/components/data-table/sticky-actions'
import { formatSoNumber } from '../sales-orders/format'
import { SHIP_STATUS_STYLES, SHIP_STATUS_LABELS, SHIP_STATUS_OPTIONS, formatShipDate } from './format'
import { SHIPPING_PAGE_SIZE } from './constants'

// ── Row type ──────────────────────────────────────────────────────────────────

export type ShippingListRow = {
  id: string
  status: string
  tracking_number: string | null
  actual_cost: number | null
  quoted_rate: number | null
  carrier: string | null
  created_at: string
  sales_order_id: string | null
  customer_id: string | null
  shipping_method_id: string | null
  sales_orders: {
    so_number: number
    title: string | null
    created_at: string
    customers: { first_name: string; last_name: string; company_name: string | null } | null
  } | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
  shipping_methods: { name: string; carrier: string | null } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_SELECT = `
  id, status, tracking_number, actual_cost, quoted_rate, carrier, created_at,
  sales_order_id, customer_id, shipping_method_id,
  sales_orders(so_number, title, created_at, customers(first_name, last_name, company_name)),
  customers(first_name, last_name, company_name),
  shipping_methods(name, carrier)
`
const PAGE_SIZE = SHIPPING_PAGE_SIZE
const DEFAULT_SORT = [{ column: 'created_at', direction: 'desc' as const }]
const SEARCH_COLUMNS = ['tracking_number']

function custName(c: { first_name: string; last_name: string; company_name: string | null } | null): string | null {
  if (!c) return null
  return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null
}

function linkedLabel(row: ShippingListRow): string {
  if (row.sales_order_id && row.sales_orders) return formatSoNumber(row.sales_orders.so_number, row.sales_orders.created_at)
  const name = custName(row.customers)
  if (row.customer_id && name) return name
  return 'Office / Standalone'
}

function Dash() {
  return <span className="text-gray-300">—</span>
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  initialRows: ShippingListRow[]
  initialTotalCount: number
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ShippingListClient({ initialRows, initialTotalCount, orgSlug, orgId, userId, userRole }: Props) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const {
    sortRules, filterRules, columnWidths: savedWidths,
    activeView, isDirty, isViewReadOnly, myViews, sharedViews, viewsLoading,
    setSort, setFilterRules, setColumnWidth, loadView, saveCurrentView, createView, deleteView,
  } = useSavedView({ tableKey: 'shipments', orgId, userId, userRole })

  const activeSortRules = sortRules.length > 0 ? sortRules : DEFAULT_SORT

  const COLUMNS = useMemo((): ColumnDef<ShippingListRow>[] => [
    { key: 'linked', label: 'SO / Customer', defaultWidth: 220, sortable: false, filterable: false, getValue: (r) => linkedLabel(r) },
    { key: 'method', label: 'Method', defaultWidth: 180, sortable: false, filterable: false, getValue: (r) => r.shipping_methods?.name ?? r.carrier },
    {
      key: 'status', label: 'Status', defaultWidth: 120, sortable: true, filterable: true, filterType: 'select',
      filterOptions: SHIP_STATUS_OPTIONS, getValue: (r) => r.status,
    },
    { key: 'tracking_number', label: 'Tracking', defaultWidth: 180, sortable: false, filterable: true, filterType: 'text', getValue: (r) => r.tracking_number },
    { key: 'cost', label: 'Cost', defaultWidth: 110, sortable: true, filterable: false, getValue: (r) => r.actual_cost ?? r.quoted_rate },
    { key: 'created_at', label: 'Created', defaultWidth: 130, sortable: true, filterable: false, getValue: (r) => r.created_at },
    { key: 'actions', label: '', defaultWidth: 70, sortable: false, filterable: false, resizable: false },
  ], [])

  const defaultWidths = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of COLUMNS) map[c.key] = c.defaultWidth
    return map
  }, [COLUMNS])

  const { widths: colWidths, startResize } = useColumnResize({ defaultWidths, savedWidths, onWidthCommit: setColumnWidth, disabled: isViewReadOnly })

  const { rows: liveRows, totalCount: liveTotalCount, loading } = useDataTableQuery<ShippingListRow>({
    tableKey: 'shipments',
    orgId,
    select: DB_SELECT,
    filterRules,
    sortRules: activeSortRules,
    search,
    searchColumns: SEARCH_COLUMNS,
    page,
    pageSize: PAGE_SIZE,
    initialRows,
    initialTotalCount,
  })

  useEffect(() => { setPage(1) }, [filterRules, sortRules])

  function SortIcon({ column }: { column: string }) {
    const rule = activeSortRules.find((r) => r.column === column)
    if (rule?.direction === 'asc') return <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75 12 8.25l7.5 7.5" /></svg>
    if (rule?.direction === 'desc') return <svg className="h-3 w-3 text-qm-lime" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>
    return <svg className="h-3 w-3 opacity-20" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
  }

  const totalWidth = COLUMNS.reduce((sum, c) => sum + (colWidths[c.key] ?? c.defaultWidth), 0)
  const totalPages = Math.max(1, Math.ceil(liveTotalCount / PAGE_SIZE))

  if (initialRows.length === 0 && filterRules.length === 0 && !search && !loading) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <p className="text-sm font-medium text-gray-900">No shipments yet</p>
        <p className="mt-1 text-sm text-gray-500">Shipments created here or from a Sales Order will show up in this list.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search by tracking number..."
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

      <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm transition-opacity ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
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
                const isRight = col.key === 'cost'
                return (
                  <th
                    key={col.key}
                    onClick={isSortable ? () => setSort(col.key) : undefined}
                    className={`relative px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${isSortable ? 'cursor-pointer hover:bg-gray-100' : ''} ${isActions ? STICKY_ACTIONS_TH : isRight ? 'text-right' : 'text-left'}`}
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
            {liveRows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-sm text-gray-500">
                  {search || filterRules.length > 0 ? 'No shipments match the current filters.' : 'No shipments yet.'}
                </td>
              </tr>
            ) : liveRows.map((r) => {
              const soHref = r.sales_order_id ? `/dashboard/${orgSlug}/sales-orders/${r.sales_order_id}` : null
              const detailHref = `/dashboard/${orgSlug}/shipping/${r.id}`
              const custLabel = custName(r.sales_order_id ? r.sales_orders?.customers ?? null : r.customers)
              const methodLabel = r.shipping_methods?.name ?? r.carrier
              return (
                <tr key={r.id} className="group hover:bg-gray-50">
                  <td className="overflow-hidden px-4 py-3">
                    <Link href={detailHref} className="block truncate text-sm font-medium text-qm-fuchsia hover:underline">
                      {linkedLabel(r)}
                    </Link>
                    {custLabel && <div className="truncate text-xs text-gray-500">{custLabel}</div>}
                  </td>
                  <td className="overflow-hidden whitespace-nowrap px-4 py-3 text-sm text-gray-700">{methodLabel ?? <Dash />}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHIP_STATUS_STYLES[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {SHIP_STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="overflow-hidden whitespace-nowrap px-4 py-3 text-sm font-mono text-gray-700">{r.tracking_number ?? <Dash />}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-right tabular-nums text-gray-900">
                    {r.actual_cost != null ? `$${Number(r.actual_cost).toFixed(2)}` : r.quoted_rate != null ? <span className="text-gray-400">${Number(r.quoted_rate).toFixed(2)} est.</span> : <Dash />}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{formatShipDate(r.created_at)}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right ${STICKY_ACTIONS_TD}`}>
                    {soHref && <Link href={soHref} className="text-sm text-qm-lime hover:underline">View SO</Link>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-3 text-sm text-gray-500">
          <span>
            {liveTotalCount === 0
              ? '0 shipments'
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
    </div>
  )
}
