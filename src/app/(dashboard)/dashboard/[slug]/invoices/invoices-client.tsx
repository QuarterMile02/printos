'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { formatInvNumber, formatCents, INV_STATUS_STYLES, INV_STATUS_LABELS, INV_FILTER_TABS } from './format'

type Invoice = {
  id: string
  invoice_number: number
  status: string
  total: number
  balance_due: number
  due_date: string | null
  created_at: string
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

type Props = {
  slug: string
  orgId: string
  orgName: string
  invoices: Invoice[]
  totalCount: number
  filter: string
  bucket?: string
}

export default function InvoicesClient({ slug, orgId, orgName, invoices, totalCount, filter, bucket }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'warn' | 'error' | 'info' } | null>(null)

  function showToast(msg: string, type: 'warn' | 'error' | 'info' = 'info') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const allSelected = invoices.length > 0 && selected.size === invoices.length

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(invoices.map(i => i.id)))
    }
  }, [allSelected, invoices])

  const toggleOne = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  async function handleBulkExport() {
    const ids = Array.from(selected)
    const draftIds = invoices.filter(i => ids.includes(i.id) && i.status === 'draft').map(i => i.id)
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
    info:  'bg-green-50  border-green-200  text-green-800',
    warn:  'bg-amber-50  border-amber-200  text-amber-800',
    error: 'bg-red-50    border-red-200    text-red-800',
  }

  return (
    <div className="p-8">
      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg ${toastColors[toast.type]}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{orgName}</Link>
          <span>/</span>
          <span className="text-gray-700">Invoices</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
            <p className="mt-1 text-sm text-gray-500">
              {totalCount === 0 ? 'No invoices yet.' : `${totalCount} invoice${totalCount === 1 ? '' : 's'}`}
              {bucket && (
                <span className="ml-2 inline-flex items-center gap-2 rounded-full bg-qm-fuchsia/10 px-2.5 py-0.5 text-xs font-semibold text-qm-fuchsia">
                  Overdue {bucket} days
                  <Link href={`/dashboard/${slug}/invoices`} className="text-[#888] hover:text-qm-fuchsia">×</Link>
                </span>
              )}
            </p>
            {invoices.length === 1000 && totalCount > 1000 && (
              <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-block">
                Showing 1000 of {totalCount} — use filter to narrow results
              </p>
            )}
          </div>

          {/* Bulk export button — visible when 1+ selected */}
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
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {INV_FILTER_TABS.map((tab) => {
          const active = (filter || 'all') === tab.value
          const href = tab.value === 'all' ? `/dashboard/${slug}/invoices` : `/dashboard/${slug}/invoices?status=${tab.value}`
          return (
            <Link
              key={tab.value}
              href={href}
              className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-qm-fuchsia text-qm-fuchsia' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No invoices{filter && filter !== 'all' ? ` with status "${filter}"` : ''}</p>
          <p className="mt-1 text-sm text-gray-500">Invoices are created when a Sales Order is completed.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 accent-green-600 cursor-pointer"
                    title="Select all"
                  />
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Customer</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Balance</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Due</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className={`hover:bg-gray-50 ${selected.has(inv.id) ? 'bg-green-50/40' : ''}`}>
                  <td className="w-10 px-4 py-4">
                    <input
                      type="checkbox"
                      checked={selected.has(inv.id)}
                      onChange={() => toggleOne(inv.id)}
                      className="h-4 w-4 rounded border-gray-300 accent-green-600 cursor-pointer"
                    />
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link href={`/dashboard/${slug}/invoices/${inv.id}`} className="text-sm font-medium text-qm-fuchsia hover:underline">
                      {formatInvNumber(inv.invoice_number, inv.created_at)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {inv.customers
                      ? `${inv.customers.first_name} ${inv.customers.last_name}${inv.customers.company_name ? ` (${inv.customers.company_name})` : ''}`
                      : <span className="text-gray-300">&mdash;</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900 text-right">${formatCents(inv.total)}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-right">
                    <span className={inv.balance_due > 0 ? 'text-red-600' : 'text-green-600'}>${formatCents(inv.balance_due)}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${INV_STATUS_STYLES[inv.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {INV_STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {inv.due_date ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-right">
                    <a
                      href={`/api/invoices/${inv.id}/export-iif`}
                      className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline"
                      title="Export to QuickBooks"
                    >
                      QB
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
