'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

type Vendor = { id: string; name: string }

type Props = {
  slug: string
  orgId: string
}

// Preserves the exact creation flow from the pre-rollout
// PurchaseOrdersPageClient.tsx: title + vendor search-and-select +
// expected delivery, POST to /api/purchase-orders, then navigate to the
// new PO's detail page on success.
export function CreatePoButton({ slug, orgId }: Props) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

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
    <>
      <button
        onClick={() => setShowCreate(true)}
        className="inline-flex items-center gap-2 rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-105"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
        New PO
      </button>

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
                className="flex-1 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-105 disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create PO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}
    </>
  )
}
