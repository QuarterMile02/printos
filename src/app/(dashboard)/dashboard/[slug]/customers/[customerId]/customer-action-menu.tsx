'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { deleteCustomer, deactivateCustomer } from '../actions'

// ── Static menu data — defined at module level, never recreated per render ──────

const CREATE_ITEMS: Array<{ label: string; path: string; enabled: boolean }> = [
  { label: 'Quote',        path: 'quotes/new',    enabled: true },
  { label: 'Sales Order',  path: 'sales-orders',  enabled: true },
  { label: 'Invoice',      path: 'invoices',       enabled: true },
  { label: 'Payment',      path: '',               enabled: false },
  { label: 'Job',          path: 'jobs',           enabled: true },
  { label: 'Sales Lead',   path: '',               enabled: false },
]

const DISABLED_ITEMS: string[] = ['Send Invoice Statements', 'Enable Customer Portal', 'Merge Customer']

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  customerName: string
  isActive: boolean | null
  isOwnerOrAdmin: boolean
}

export default function CustomerActionMenu({
  customerId,
  orgId,
  orgSlug,
  customerName,
  isActive,
  isOwnerOrAdmin,
}: Props) {
  const [open, setOpen]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start]  = useTransition()
  const menuRef           = useRef<HTMLDivElement>(null)

  // Outside-click + Escape to close — listeners only active while open
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
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

  // ── Handlers (never called during render) ─────────────────────────────────

  function go(path: string) {
    setOpen(false)
    window.location.href = `/dashboard/${orgSlug}/${path}`
  }

  function onDisable() {
    setOpen(false)
    if (!window.confirm(`Disable "${customerName}"? They'll be hidden from active lists but all records are preserved.`)) return
    setError(null)
    start(async () => {
      const res = await deactivateCustomer(customerId, orgId, orgSlug)
      if (res.error) { setError(res.error); return }
      window.location.reload()
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

  const canDelete = isActive === false

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600 max-w-xs truncate">{error}</span>}

      {/* Pencil — scrolls to customer details */}
      <a
        href="#section-customer-details"
        className="inline-flex items-center justify-center rounded-md border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 transition-colors"
        title="Edit customer details"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
        </svg>
      </a>

      {/* Kebab — isolated div with its own ref */}
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
            {CREATE_ITEMS.map((item) =>
              item.enabled ? (
                <button
                  key={item.label}
                  type="button"
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => go(item.path)}
                >
                  {item.label}
                </button>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  disabled
                  className="w-full text-left px-4 py-2 text-sm text-gray-300 cursor-not-allowed"
                >
                  {item.label}
                </button>
              )
            )}

            <div className="border-t border-gray-100 my-1" />

            {/* Placeholder items */}
            {DISABLED_ITEMS.map((label) => (
              <button
                key={label}
                type="button"
                disabled
                className="w-full text-left px-4 py-2 text-sm text-gray-300 cursor-not-allowed"
              >
                {label}
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
                    {pending ? 'Disabling…' : 'Disable Customer'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => go(`customers/${customerId}`)}
                  >
                    Enable Customer
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
                    title="Disable customer first to enable deletion"
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
