'use client'

import { useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useTransition } from 'react'
import type { PricingType, ProductStatus } from '@/types/product-builder'
import { copyProduct, searchProducts, type ProductSearchRow } from './actions'
import type { ColumnDef } from '@/components/data-table/types'
import { useSavedView, applyFilterRules, applySortRules } from '@/components/data-table/use-saved-view'
import { useColumnResize } from '@/components/data-table/use-column-resize'
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar'

export type MigrationStatus = 'shopvox_reference' | 'in_progress' | 'printos_ready'

export type ProductRow = {
  id: string
  name: string
  part_number: string | null
  category_name: string | null
  product_type: string | null
  pricing_type: PricingType | null
  formula: string | null
  price: number | null
  status: ProductStatus | null
  active: boolean | null
  is_enabled: boolean | null
  updated_at: string | null
  migration_status: MigrationStatus | null
}

const MIGRATION_STYLES: Record<MigrationStatus, { label: string; cls: string }> = {
  shopvox_reference: { label: 'ShopVOX',       cls: 'bg-gray-100 text-gray-700 border-gray-200'   },
  in_progress:       { label: 'In Progress',   cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  printos_ready:     { label: 'PrintOS Ready', cls: 'bg-green-100 text-green-700 border-green-200' },
}

const STATUS_STYLES: Record<ProductStatus, string> = {
  draft:     'bg-qm-gray-light text-qm-gray',
  published: 'bg-qm-lime text-white',
  disabled:  'bg-red-50 text-red-700',
}
const STATUS_LABELS: Record<ProductStatus, string> = {
  draft:     'Draft',
  published: 'Published',
  disabled:  'Disabled',
}

const PRICING_TYPE_STYLES: Record<string, string> = {
  Formula:     'bg-indigo-50 text-indigo-700 border-indigo-100',
  Basic:       'bg-sky-50 text-sky-700 border-sky-100',
  Grid:        'bg-purple-50 text-purple-700 border-purple-100',
  'Cost Plus': 'bg-amber-50 text-amber-800 border-amber-100',
}

// ProductSearchRow's fields are widened to plain `string | null` (a Postgres
// RPC's RETURNS TABLE can't carry TS's branded PricingType/ProductStatus
// unions) — this just narrows them back for display, values are identical.
function toProductRow(r: ProductSearchRow): ProductRow {
  return {
    ...r,
    pricing_type: r.pricing_type as PricingType | null,
    status: r.status as ProductStatus | null,
    migration_status: r.migration_status as MigrationStatus | null,
  }
}

function formatPrice(cents: number | null): string {
  if (cents == null) return '—'
  return '$' + cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type StatusTab = 'all' | 'published' | 'draft' | 'disabled' | 'enabled'

function ProductCard({
  p,
  orgSlug,
  canSeePricing,
}: {
  p: ProductRow
  orgSlug: string
  canSeePricing: boolean
}) {
  const editHref = `/dashboard/${orgSlug}/products/${p.id}/edit`
  return (
    <Link
      href={editHref}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:border-qm-lime hover:shadow-md transition-all"
    >
      <div className="font-semibold text-sm text-qm-black truncate" title={p.name}>
        {p.name}
      </div>
      {p.category_name && (
        <div className="text-xs text-qm-gray truncate">{p.category_name}</div>
      )}
      <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
        {p.status && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[p.status]}`}>
            {STATUS_LABELS[p.status]}
          </span>
        )}
        {canSeePricing && p.price != null && (
          <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700">
            {formatPrice(p.price)}
          </span>
        )}
      </div>
    </Link>
  )
}

export default function ProductsListClient({
  products,
  orgSlug,
  orgId,
  userId,
  userRole,
  canSeePricing,
}: {
  products: ProductRow[]
  orgSlug: string
  orgId: string
  userId: string
  userRole: string
  canSeePricing: boolean
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')
  const [category, setCategory] = useState<string>('all')
  const [dept, setDept] = useState<string>('all')
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Search mode: when active (term.length >= 2), a real server-side fuzzy
  // RPC (search_products_fuzzy, migration 127) replaces the local
  // .includes() filter below — that filter only ever saw whatever subset
  // of up to 1000 preloaded products happened to be in memory. Same
  // debounced-input -> RPC call -> results-state pattern as Customers/
  // Vendors' searchCustomers/searchVendors. While a search is active, tab/
  // category/dept and saved-view filter rules are bypassed (matching
  // Customers' precedent) — the RPC already scopes to org + term; only
  // sort rules are re-applied client-side.
  const [searchResults, setSearchResults] = useState<ProductRow[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)

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
      const results = await searchProducts(orgId, term)
      if (searchSeqRef.current === seq) {
        setSearchResults(results.map(toProductRow))
        setIsSearching(false)
      }
    }, 300)
  }

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
  } = useSavedView({ tableKey: 'products', orgId, userId, userRole })

  // ── Column definitions ───────────────────────────────────────────────────
  const categoryOptions = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.category_name) set.add(p.category_name)
    return Array.from(set).sort()
  }, [products])

  const deptOptions = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.product_type) set.add(p.product_type)
    return Array.from(set).sort()
  }, [products])

  const COLUMNS = useMemo((): ColumnDef<ProductRow>[] => [
    {
      key: 'name', label: 'Name', defaultWidth: 220,
      sortable: true, filterable: true, filterType: 'text',
      getValue: (r) => r.name,
    },
    {
      key: 'category_name', label: 'Category', defaultWidth: 140,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: categoryOptions.map((c) => ({ label: c, value: c })),
      getValue: (r) => r.category_name,
    },
    {
      key: 'product_type', label: 'Type', defaultWidth: 160,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: deptOptions.map((d) => ({ label: d, value: d })),
      getValue: (r) => r.product_type,
    },
    {
      key: 'pricing_type', label: 'Pricing', defaultWidth: 130,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: [
        { label: 'Formula', value: 'Formula' },
        { label: 'Basic', value: 'Basic' },
        { label: 'Grid', value: 'Grid' },
        { label: 'Cost Plus', value: 'Cost Plus' },
      ],
      getValue: (r) => r.pricing_type,
    },
    ...(canSeePricing ? [{
      key: 'price', label: 'Price', defaultWidth: 88,
      sortable: true, filterable: false,
      getValue: (r: ProductRow) => r.price,
    }] : []),
    {
      key: 'status', label: 'Status', defaultWidth: 128,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: [
        { label: 'Published', value: 'published' },
        { label: 'Draft', value: 'draft' },
        { label: 'Disabled', value: 'disabled' },
      ],
      getValue: (r) => r.status,
    },
    {
      key: 'migration_status', label: 'Migration', defaultWidth: 116,
      sortable: true, filterable: true, filterType: 'select',
      filterOptions: [
        { label: 'ShopVOX',       value: 'shopvox_reference' },
        { label: 'In Progress',   value: 'in_progress' },
        { label: 'PrintOS Ready', value: 'printos_ready' },
      ],
      getValue: (r) => r.migration_status,
    },
    {
      key: 'updated_at', label: 'Updated', defaultWidth: 96,
      sortable: true, filterable: false,
      getValue: (r) => r.updated_at,
    },
    {
      key: 'actions', label: 'Actions', defaultWidth: 180,
      sortable: false, filterable: false, resizable: false,
    },
  ], [categoryOptions, deptOptions, canSeePricing])

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

  // ── Filtered + sorted rows ───────────────────────────────────────────────
  const tabCounts = useMemo(() => ({
    all:       products.length,
    published: products.filter((p) => p.status === 'published').length,
    draft:     products.filter((p) => p.status === 'draft').length,
    disabled:  products.filter((p) => p.status === 'disabled').length,
    enabled:   products.filter((p) => p.is_enabled).length,
  }), [products])

  const filtered = useMemo(() => {
    // Search mode: server-side fuzzy results replace the local rows
    // entirely (bypasses tab/category/dept/saved-view filters, matching
    // Customers' precedent — the RPC already scopes to org + term); only
    // sort rules are re-applied client-side.
    if (searchResults !== null) {
      return sortRules.length > 0 ? applySortRules(searchResults, sortRules, COLUMNS) : searchResults
    }
    // Browse mode: tab + category/dept dropdowns + saved-view filters + sort
    let rows = products.filter((p) => {
      if (tab === 'published' && p.status !== 'published') return false
      if (tab === 'draft'     && p.status !== 'draft')     return false
      if (tab === 'disabled'  && p.status !== 'disabled')  return false
      if (tab === 'enabled'   && !p.is_enabled)             return false
      if (category !== 'all'  && p.category_name !== category) return false
      if (dept !== 'all'      && p.product_type !== dept)   return false
      return true
    })
    rows = applyFilterRules(rows, filterRules, COLUMNS)
    rows = applySortRules(rows, sortRules, COLUMNS)
    return rows
  }, [products, tab, category, dept, filterRules, sortRules, COLUMNS, searchResults])

  function handleCopy(id: string) {
    setCopyingId(id)
    startTransition(async () => {
      const result = await copyProduct(id, orgId, orgSlug)
      if (result?.error) {
        alert(result.error)
        setCopyingId(null)
      }
    })
  }

  // ── Sort indicator helper ────────────────────────────────────────────────
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

  // Total table width for explicit sizing
  const totalWidth = COLUMNS.reduce(
    (sum, c) => sum + (colWidths[c.key] ?? c.defaultWidth),
    0,
  )

  return (
    <>
      {/* Status tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(['all', 'published', 'draft', 'disabled', 'enabled'] as StatusTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-qm-lime text-qm-lime'
                : 'border-transparent text-qm-gray hover:text-qm-black'
            }`}
          >
            {t === 'all' ? 'All' : t === 'published' ? 'Published' : t === 'draft' ? 'Draft' : t === 'disabled' ? 'Disabled' : 'Enabled'}
            <span className="ml-1.5 text-xs text-qm-gray">({tabCounts[t]})</span>
          </button>
        ))}
      </div>

      {/* Search + Filters row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          {isSearching ? (
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-lime animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by name, part number, category..."
            className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="all">All categories</option>
          {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="all">All departments</option>
          {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Filters + Views toolbar */}
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

      {/* Table / Card grid */}
      {products.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-qm-lime-light text-qm-lime-dark">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-medium text-gray-900">No products yet</p>
          <p className="mt-1 text-sm text-gray-500">Import from ShopVOX or add your first product.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
          <p className="text-sm text-qm-gray">
            {searchResults !== null ? `No products match "${search}"` : 'No products match your filters.'}
          </p>
        </div>
      ) : viewMode === 'card' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filtered.map((p) => (
              <ProductCard key={p.id} p={p} orgSlug={orgSlug} canSeePricing={canSeePricing} />
            ))}
          </div>
          <div className="mt-2 text-xs text-qm-gray">
            {searchResults !== null
              ? `${filtered.length} result${filtered.length === 1 ? '' : 's'} from database`
              : `Showing ${filtered.length} of ${products.length} products`}
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
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
                      className={`relative px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 select-none ${
                        isSortable ? 'cursor-pointer hover:bg-gray-100' : ''
                      } ${col.key === 'price' ? 'text-right' : ''} ${
                        col.key === 'actions' ? 'text-right' : ''
                      }`}
                    >
                      <div className={`flex items-center gap-1 ${col.key === 'price' || col.key === 'actions' ? 'justify-end' : ''}`}>
                        {col.label}
                        {col.sortable && col.key !== 'actions' && <SortIcon column={col.key} />}
                      </div>
                      {/* Resize handle — skip for last column and non-resizable columns */}
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
              {filtered.map((p) => {
                const migrationStatus = p.migration_status ?? 'shopvox_reference'
                const migrationStyle = MIGRATION_STYLES[migrationStatus]
                const editHref = `/dashboard/${orgSlug}/products/${p.id}/edit`
                const migrateHref = `/dashboard/${orgSlug}/products/${p.id}/migrate`
                return (
                  <tr key={p.id} className="hover:bg-gray-50 cursor-pointer">
                    <td className="overflow-hidden">
                      <Link href={editHref} className="block px-4 py-4 min-w-0">
                        <div className="truncate text-sm font-semibold text-qm-black" title={p.name}>{p.name}</div>
                        {p.part_number && (
                          <div className="truncate text-xs text-qm-gray">{p.part_number}</div>
                        )}
                      </Link>
                    </td>
                    <td className="overflow-hidden">
                      <Link href={editHref} className="block truncate px-4 py-4 text-sm text-gray-500" title={p.category_name ?? undefined}>
                        {p.category_name ?? <span className="text-gray-300">—</span>}
                      </Link>
                    </td>
                    <td className="overflow-hidden">
                      <Link href={editHref} className="block truncate px-4 py-4 text-sm text-gray-500" title={p.product_type ?? undefined}>
                        {p.product_type ?? <span className="text-gray-300">—</span>}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-4 py-4">
                        {p.pricing_type ? (
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PRICING_TYPE_STYLES[p.pricing_type] ?? 'bg-gray-50 text-gray-600 border-gray-100'}`}>
                            {p.pricing_type}
                            {p.pricing_type === 'Formula' && p.formula ? ` · ${p.formula}` : ''}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </Link>
                    </td>
                    {canSeePricing && (
                      <td className="whitespace-nowrap">
                        <Link href={editHref} className="block px-4 py-4 text-sm font-medium text-qm-black text-right">
                          {formatPrice(p.price)}
                        </Link>
                      </td>
                    )}
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-4 py-4">
                        <div className="flex flex-col gap-1">
                          {p.status ? (
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[p.status]}`}>
                              {STATUS_LABELS[p.status]}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                          {p.is_enabled === false && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                              <svg className="h-2.5 w-2.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                              ShopVOX off
                            </span>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-4 py-4">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${migrationStyle.cls}`}>
                          {migrationStyle.label}
                        </span>
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-4 py-4 text-xs text-qm-gray">
                        {formatRelative(p.updated_at)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={editHref}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-md bg-qm-lime px-2.5 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                        >
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125" />
                          </svg>
                          Edit
                        </Link>
                        <Link
                          href={migrateHref}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                        >
                          Migrate
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                          </svg>
                        </Link>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleCopy(p.id) }}
                          disabled={isPending && copyingId === p.id}
                          title="Duplicate product"
                          className="rounded p-1.5 text-qm-gray hover:bg-qm-lime-light hover:text-qm-lime-dark disabled:opacity-40"
                        >
                          {isPending && copyingId === p.id ? (
                            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" className="opacity-75" />
                            </svg>
                          ) : (
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-2 text-xs text-qm-gray">
            {searchResults !== null
              ? `${filtered.length} result${filtered.length === 1 ? '' : 's'} from database`
              : `Showing ${filtered.length} of ${products.length} products`}
          </div>
        </div>
      )}
    </>
  )
}
