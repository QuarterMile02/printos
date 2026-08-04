'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { deleteCustomer, deactivateCustomer, reactivateCustomer, createSalesLeadForCustomer } from '../actions'

// Static data — module level, never recreated per render
const CREATE_ITEMS: Array<{ label: string; key: string }> = [
  { label: 'Quote',        key: 'quote' },
  { label: 'Sales Order',  key: 'sales-order' },
  { label: 'Invoice',      key: 'invoice' },
  { label: 'Payment',      key: 'payment' },
  { label: 'Job',          key: 'job' },
  { label: 'Sales Lead',   key: 'sales-lead' },
]

const MISC_ITEMS: Array<{ label: string; key: string }> = [
  { label: 'Send Invoice Statements', key: 'invoice-statements' },
  { label: 'Enable Customer Portal',  key: 'customer-portal' },
  { label: 'Merge Customer',          key: 'merge' },
]

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  customerName: string
  isActive: boolean | null
  isOwnerOrAdmin: boolean
  // Quotes/jobs/sales orders/invoices currently linked to this customer, as
  // display strings (e.g. "3 quotes") -- same check deleteCustomer itself
  // enforces server-side. Empty array means delete is actually possible.
  linkedRecords: string[]
}

export default function CustomerActionMenu({
  customerId,
  orgId,
  orgSlug,
  customerName,
  isActive,
  isOwnerOrAdmin,
  linkedRecords,
}: Props) {
  const router   = useRouter()
  const [open, setOpen]   = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start]  = useTransition()
  const menuRef           = useRef<HTMLDivElement>(null)
  const toastRef          = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Outside-click + Escape to close
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function showToast(msg: string) {
    setToast(msg)
    if (toastRef.current) clearTimeout(toastRef.current)
    toastRef.current = setTimeout(() => setToast(null), 3500)
  }

  function go(path: string) {
    setOpen(false)
    router.push(`/dashboard/${orgSlug}/${path}`)
  }

  function handleCreate(key: string) {
    setOpen(false)
    const cid = `?customer_id=${customerId}`
    if (key === 'quote')       return go(`quotes/new${cid}`)
    if (key === 'sales-order') return go(`sales-orders/new${cid}`)
    if (key === 'invoice')     return go(`invoices/new${cid}`)
    if (key === 'payment')     return go(`invoices${cid}&action=payment`)
    if (key === 'job')         return go(`sales-orders/new${cid}`) // jobs created from SOs
    if (key === 'sales-lead') {
      start(async () => {
        const res = await createSalesLeadForCustomer(customerId, orgId, orgSlug)
        if (res.error) { setError(res.error); return }
        showToast('Sales lead created')
        router.refresh()
      })
    }
  }

  function handleMisc(key: string) {
    setOpen(false)
    if (key === 'invoice-statements') return showToast('This feature is coming soon')
    if (key === 'customer-portal')    return showToast('Customer portal coming in Phase 3')
    if (key === 'merge')              return showToast('Merge feature coming soon')
  }

  function onDisable() {
    setOpen(false)
    if (!window.confirm(`Disable "${customerName}"? They'll be hidden from active lists but all records are preserved.`)) return
    setError(null)
    start(async () => {
      const res = await deactivateCustomer(customerId, orgId, orgSlug)
      if (res.error) { setError(res.error); return }
      showToast('Customer disabled')
      router.refresh()
    })
  }

  function onDelete() {
    setOpen(false)
    if (!window.confirm(`Permanently delete "${customerName}"? This cannot be undone.`)) return
    setError(null)
    start(async () => {
      const res = await deleteCustomer(customerId, orgId, orgSlug)
      if (res.error) { setError(res.error); return }
      window.location.href = `/dashboard/${orgSlug}/customers`
    })
  }

  function onPencilClick() {
    // Dispatch custom event to CustomerDetailClient to open both cards in edit mode
    window.dispatchEvent(new CustomEvent('customer:open-edit'))
    // Scroll to section
    const el = document.getElementById('section-customer-details')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const canDelete = linkedRecords.length === 0

  return (
    <div className="flex items-center gap-2">
      {/* Toast / error feedback */}
      {(toast || error) && (
        <span className={`text-xs font-medium max-w-xs truncate ${error ? 'text-red-600' : 'text-green-700'}`}>
          {error ?? toast}
        </span>
      )}

      {/* Pencil — opens inline edit for Address + Customer Details */}
      <button
        type="button"
        onClick={onPencilClick}
        className="inline-flex items-center justify-center rounded-md border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 transition-colors"
        title="Edit customer details"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
        </svg>
      </button>

      {/* Kebab */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center justify-center rounded-md border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 transition-colors"
          aria-label="More actions"
          aria-expanded={open}
        >
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="2"  r="1.5" />
            <circle cx="8" cy="8"  r="1.5" />
            <circle cx="8" cy="14" r="1.5" />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 z-[9999] w-56 rounded-lg border border-gray-200 bg-white shadow-xl py-1">

            {/* CREATE section */}
            <div className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 select-none">
              Create
            </div>
            {CREATE_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                disabled={pending}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                onClick={() => handleCreate(item.key)}
              >
                {item.label}
              </button>
            ))}

            <div className="border-t border-gray-100 my-1" />

            {/* Misc items */}
            {MISC_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => handleMisc(item.key)}
              >
                {item.label}
              </button>
            ))}

            {/* Danger zone — owner/admin only */}
            {isOwnerOrAdmin && (
              <>
                <div className="border-t border-gray-100 my-1" />

                {isActive !== false ? (
                  <button
                    type="button"
                    disabled={pending}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    onClick={onDisable}
                  >
                    {pending ? 'Saving…' : 'Disable Customer'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    onClick={() => {
                      setOpen(false)
                      setError(null)
                      start(async () => {
                        const res = await reactivateCustomer(customerId, orgId, orgSlug)
                        if (res.error) { setError(res.error); return }
                        showToast('Customer enabled')
                        router.refresh()
                      })
                    }}
                  >
                    {pending ? 'Saving…' : 'Enable Customer'}
                  </button>
                )}

                {canDelete ? (
                  <button
                    type="button"
                    disabled={pending}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    onClick={onDelete}
                  >
                    {pending ? 'Deleting…' : 'Delete Customer'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    title={`Cannot delete — linked to ${linkedRecords.join(', ')}. Deactivate instead.`}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 cursor-not-allowed"
                  >
                    Delete Customer
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
