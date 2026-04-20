'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import type { PricingType, ProductStatus } from '@/types/product-builder'
import { copyProduct } from './actions'

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
  updated_at: string | null
  migration_status: MigrationStatus | null
}

const MIGRATION_STYLES: Record<MigrationStatus, { label: string; cls: string }> = {
  shopvox_reference: { label: 'ShopVOX',      cls: 'bg-gray-100 text-gray-700 border-gray-200' },
  in_progress:       { label: 'In Progress',  cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  printos_ready:     { label: 'PrintOS Ready', cls: 'bg-green-100 text-green-700 border-green-200' },
}

const STATUS_STYLES: Record<ProductStatus, string> = {
  draft:     'bg-qm-gray-light text-qm-gray',
  published: 'bg-qm-lime text-white',
  disabled:  'bg-red-50 text-red-700',
  archived:  'bg-qm-black/5 text-qm-gray',
}

const STATUS_LABELS: Record<ProductStatus, string> = {
  draft:     'Draft',
  published: 'Published',
  disabled:  'Disabled',
  archived:  'Archived',
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

type StatusTab = 'all' | 'published' | 'draft' | 'disabled'

export default function ProductsListClient({
  products,
  orgSlug,
  orgId,
  canSeePricing,
}: {
  products: ProductRow[]
  orgSlug: string
  orgId: string
  canSeePricing: boolean
}) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<StatusTab>('all')
  const [category, setCategory] = useState<string>('all')
  const [dept, setDept] = useState<string>('all')
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  void orgId

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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((p) => {
      if (tab === 'published' && p.status !== 'published') return false
      if (tab === 'draft' && p.status !== 'draft') return false
      if (tab === 'disabled' && p.status !== 'disabled') return false
      if (category !== 'all' && p.category_name !== category) return false
      if (dept !== 'all' && p.product_type !== dept) return false
      if (term) {
        const hay = `${p.name} ${p.part_number ?? ''} ${p.category_name ?? ''} ${p.product_type ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [products, search, tab, category, dept])

  const tabCounts = useMemo(() => ({
    all: products.length,
    published: products.filter((p) => p.status === 'published').length,
    draft: products.filter((p) => p.status === 'draft').length,
    disabled: products.filter((p) => p.status === 'disabled').length,
  }), [products])

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

  return (
    <>
      {/* Status tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        {(['all', 'published', 'draft', 'disabled'] as StatusTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-qm-lime text-qm-lime' : 'border-transparent text-qm-gray hover:text-qm-black'
            }`}
          >
            {t === 'all' ? 'All' : t === 'published' ? 'Active' : t === 'draft' ? 'Draft' : 'Disabled'}
            <span className="ml-1.5 text-xs text-qm-gray">({tabCounts[t]})</span>
          </button>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
      </div>

      {/* Table */}
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
          <p className="text-sm text-qm-gray">No products match your filters.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Pricing</th>
                {canSeePricing && (
                  <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price</th>
                )}
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Migration</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Updated</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => {
                const migrationStatus = p.migration_status ?? 'printos_ready'
                const migrationStyle = MIGRATION_STYLES[migrationStatus]
                const needsMigration = migrationStatus !== 'printos_ready'
                const editHref = needsMigration
                  ? `/dashboard/${orgSlug}/products/${p.id}/migrate`
                  : `/dashboard/${orgSlug}/products/${p.id}/edit`
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-6 py-4">
                        <div className="text-sm font-semibold text-qm-black">{p.name}</div>
                        {p.part_number && (
                          <div className="text-xs text-qm-gray">{p.part_number}</div>
                        )}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-6 py-4 text-sm text-gray-500">
                        {p.category_name ?? <span className="text-gray-300">—</span>}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-6 py-4 text-sm text-gray-500">
                        {p.product_type ?? <span className="text-gray-300">—</span>}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-6 py-4 text-sm text-gray-500">
                        {p.pricing_type ? (
                          <span>
                            {p.pricing_type}
                            {p.pricing_type === 'Formula' && p.formula ? ` · ${p.formula}` : ''}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </Link>
                    </td>
                    {canSeePricing && (
                      <td className="whitespace-nowrap">
                        <Link href={editHref} className="block px-6 py-4 text-sm font-medium text-qm-black text-right">
                          {formatPrice(p.price)}
                        </Link>
                      </td>
                    )}
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-6 py-4">
                        {p.status ? (
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[p.status]}`}>
                            {STATUS_LABELS[p.status]}
                          </span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-6 py-4">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${migrationStyle.cls}`}>
                          {migrationStyle.label}
                        </span>
                        {needsMigration && (
                          <span className="ml-2 text-[11px] font-semibold text-qm-lime">Migrate →</span>
                        )}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">
                      <Link href={editHref} className="block px-6 py-4 text-xs text-qm-gray">
                        {formatRelative(p.updated_at)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-center">
                      <button
                        type="button"
                        onClick={() => handleCopy(p.id)}
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="border-t border-gray-100 bg-gray-50 px-6 py-2 text-xs text-qm-gray">
            Showing {filtered.length} of {products.length} products
          </div>
        </div>
      )}
    </>
  )
}
