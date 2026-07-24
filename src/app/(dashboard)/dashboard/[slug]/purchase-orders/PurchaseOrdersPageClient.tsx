'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { formatPoNumber, PO_STATUS_STYLES, PO_STATUS_LABELS, PO_FILTER_TABS } from './format'

type Vendor = { id: string; name: string }
type SalesOrder = { id: string; so_number: number; title: string | null }

type PurchaseOrder = {
  id: string
  po_number: number
  status: string
  title: string | null
  subtotal: number
  tax_total: number
  total: number
  expected_delivery_date: string | null
  received_date: string | null
  created_at: string
  vendor: Vendor | null
  sales_order: SalesOrder | null
}

type Props = {
  slug: string
  orgId: string
  orgName: string
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function PurchaseOrdersPageClient({ slug, orgId, orgName }: Props) {
  const router = useRouter()
  const [filter, setFilter] = useState('all')
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Create form state
  const [title, setTitle] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [vendorSearch, setVendorSearch] = useState('')
  const [vendorResults, setVendorResults] = useState<Vendor[]>([])
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null)
  const [showVendorDrop, setShowVendorDrop] = useState(false)
  const vendorRef = useRef<HTMLDivElement>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const fetchPos = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ orgId })
    if (filter !== 'all') params.set('status', filter)
    const res = await fetch(`/api/purchase-orders?${params}`)
    const data = res.ok ? await res.json() : []
    setPos(data)
    setLoading(false)
  }, [orgId, filter])

  useEffect(() => { fetchPos() }, [fetchPos])

  // Vendor search debounce
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await fetch(`/api/vendors?search=${encodeURIComponent(vendorSearch)}`)
      setVendorResults(res.ok ? await res.json() : [])
    }, 250)
    return () => clearTimeout(t)
  }, [vendorSearch])

  const resetCreate = () => {
    setTitle(''); setExpectedDate(''); setVendorSearch('')
    setSelectedVendor(null); setVendorResults([]); setShowVendorDrop(false)
  }

  const handleCreate = async () => {
    setCreating(true)
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orgId,
        title: title.trim() || null,
        vendor_id: selectedVendor?.id ?? null,
        expected_delivery_date: expectedDate || null,
      }),
    })
    if (res.ok) {
      const created = await res.json()
      setShowCreate(false)
      resetCreate()
      router.push(`/dashboard/${slug}/purchase-orders/${created.id}`)
    } else {
      showToast('Failed to create purchase order')
      setCreating(false)
    }
  }

  return (
    <div className="p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-gray-500">{orgName}</p>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            Purchase Orders
            {!loading && (
              <span className="text-sm font-normal text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5">
                {pos.length}
              </span>
            )}
          </h1>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-qm-black hover:opacity-90 transition-opacity"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New PO
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {PO_FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              filter === tab.value
                ? 'border-qm-lime text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
      ) : pos.length === 0 ? (
        <div className="mt-4 rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">No purchase orders found.</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-3 text-sm font-medium text-qm-lime hover:underline"
          >
            Create your first PO
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">PO #</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Vendor</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Title</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Linked SO</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Total</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Exp. Delivery</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pos.map((po) => (
                <tr
                  key={po.id}
                  onClick={() => router.push(`/dashboard/${slug}/purchase-orders/${po.id}`)}
                  className="hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 font-mono font-medium text-gray-900">
                    {formatPoNumber(po.po_number, po.created_at)}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{po.vendor?.name ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-gray-700">{po.title ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {po.sales_order ? `SO-${po.sales_order.so_number}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${PO_STATUS_STYLES[po.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {PO_STATUS_LABELS[po.status] ?? po.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    {fmtMoney(Number(po.total ?? 0))}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{fmtDate(po.expected_delivery_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-900">New Purchase Order</h2>
              <button onClick={() => { setShowCreate(false); resetCreate() }} className="text-gray-400 hover:text-gray-600">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Vinyl for Job #1042"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                />
              </div>

              {/* Vendor */}
              <div ref={vendorRef}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor <span className="text-gray-400 font-normal">(optional)</span></label>
                {selectedVendor ? (
                  <div className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-gray-50">
                    <span className="flex-1 font-medium text-gray-900">{selectedVendor.name}</span>
                    <button onClick={() => setSelectedVendor(null)} className="text-gray-400 hover:text-gray-600">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={vendorSearch}
                      onChange={(e) => { setVendorSearch(e.target.value); setShowVendorDrop(true) }}
                      onFocus={() => setShowVendorDrop(true)}
                      placeholder="Search vendors…"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                    />
                    {showVendorDrop && vendorResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                        {vendorResults.map((v) => (
                          <button
                            key={v.id}
                            onMouseDown={() => { setSelectedVendor(v); setVendorSearch(''); setShowVendorDrop(false) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                          >
                            {v.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Expected Delivery */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Expected Delivery <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  type="date"
                  value={expectedDate}
                  onChange={(e) => setExpectedDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-qm-lime"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setShowCreate(false); resetCreate() }}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-qm-black hover:opacity-90 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create PO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}
