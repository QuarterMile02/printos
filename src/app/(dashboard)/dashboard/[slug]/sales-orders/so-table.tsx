'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { SalesOrderStatus } from '@/types/database'
import {
  formatSoNumber,
  formatCents,
  SO_STATUS_STYLES,
  SO_STATUS_LABELS,
  SO_FILTER_TABS,
} from './format'

export type SoRow = {
  id: string
  so_number: number
  title: string
  status: SalesOrderStatus
  total: number
  created_at: string
  customer: {
    first_name: string
    last_name: string
    company_name: string | null
  } | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function SalesOrderTable({
  salesOrders,
  orgSlug,
  activeFilter,
}: {
  salesOrders: SoRow[]
  orgSlug: string
  activeFilter: string
}) {
  const router = useRouter()
  const [rows] = useState(salesOrders)

  return (
    <>
      {/* Status filter tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {SO_FILTER_TABS.map((tab) => {
          const isActive = activeFilter === tab.value
          const href = tab.value === 'all'
            ? `/dashboard/${orgSlug}/sales-orders`
            : `/dashboard/${orgSlug}/sales-orders?status=${tab.value}`
          return (
            <Link
              key={tab.value}
              href={href}
              className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                isActive
                  ? 'border-qm-fuchsia text-qm-fuchsia'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">
            {activeFilter === 'all'
              ? 'No sales orders yet'
              : `No sales orders with status "${activeFilter.replace(/_/g, ' ')}"`}
          </p>
          {activeFilter === 'all' && (
            <p className="mt-1 text-sm text-gray-500">
              Sales orders are created when a quote is converted.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Title</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Customer</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((so) => (
                <tr
                  key={so.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => router.push(`/dashboard/${orgSlug}/sales-orders/${so.id}`)}
                >
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-qm-fuchsia">
                    {formatSoNumber(so.so_number, so.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                    {so.title || <span className="text-gray-300">&mdash;</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {so.customer
                      ? `${so.customer.first_name} ${so.customer.last_name}${so.customer.company_name ? ` (${so.customer.company_name})` : ''}`
                      : <span className="text-gray-300">&mdash;</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900 text-right font-medium">
                    ${formatCents(so.total)}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${SO_STATUS_STYLES[so.status]}`}>
                      {SO_STATUS_LABELS[so.status]}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {formatDate(so.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
