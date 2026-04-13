'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { PricingType, ProductStatus } from '@/types/product-builder'

export type ProductRow = {
  id: string
  name: string
  part_number: string | null
  category_name: string | null
  pricing_type: PricingType | null
  price: number | null
  status: ProductStatus | null
  active: boolean | null
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

type StatusFilter = 'all' | ProductStatus
type PricingFilter = 'all' | PricingType

export default function ProductsListClient({
  products,
  orgSlug,
}: {
  products: ProductRow[]
  orgSlug: string
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>('all')

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (pricingFilter !== 'all' && p.pricing_type !== pricingFilter) return false
      if (term) {
        const hay = `${p.name} ${p.part_number ?? ''} ${p.category_name ?? ''}`.toLowerCase()
        if (!hay.includes(term)) return false
      }
      return true
    })
  }, [products, search, statusFilter, pricingFilter])

  return (
    <>
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
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="disabled">Disabled</option>
          <option value="archived">Archived</option>
        </select>
        <select
          value={pricingFilter}
          onChange={(e) => setPricingFilter(e.target.value as PricingFilter)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          <option value="all">All pricing types</option>
          <option value="Formula">Formula</option>
          <option value="Basic">Basic</option>
          <option value="Grid">Grid</option>
          <option value="Cost Plus">Cost Plus</option>
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
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Pricing Type</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/dashboard/${orgSlug}/products/${p.id}`)}
                >
                  <td className="whitespace-nowrap px-6 py-4">
                    <div className="text-sm font-semibold text-qm-black">{p.name}</div>
                    {p.part_number && (
                      <div className="text-xs text-qm-gray">{p.part_number}</div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {p.category_name ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {p.pricing_type ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-qm-black text-right">
                    {formatPrice(p.price)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    {p.status ? (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[p.status]}`}>
                        {STATUS_LABELS[p.status]}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
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
