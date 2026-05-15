'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { deleteCustomer, deactivateCustomer } from '../actions'

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  customerName: string
  isActive: boolean | null
  isOwnerOrAdmin: boolean
}

function MenuItem({
  children, onClick, red, dimmed, title,
}: {
  children: React.ReactNode
  onClick?: (e: React.MouseEvent) => void
  red?: boolean
  dimmed?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={dimmed}
      title={title}
      className={`w-full text-left px-4 py-2 text-sm transition-colors ${
        dimmed
          ? 'text-gray-300 cursor-not-allowed'
          : red
          ? 'text-red-600 hover:bg-red-50'
          : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 select-none pointer-events-none">
      {children}
    </div>
  )
}

function Divider() {
  return <div className="border-t border-gray-100 my-1 pointer-events-none" />
}

export default function CustomerActionMenu({
  customerId, orgId, orgSlug, customerName, isActive, isOwnerOrAdmin,
}: Props) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deactivatePending, startDeactivate] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  function nav(url: string) {
    try {
      setOpen(false)
      window.location.href = url
    } catch {
      // ignore
    }
  }

  function handleDeactivate(e: React.MouseEvent) {
    e.stopPropagation()
    setOpen(false)
    try {
      if (!confirm(`Disable "${customerName}"? They'll be hidden from active lists but all records are preserved.`)) return
      setError(null)
      startDeactivate(async () => {
        try {
          const res = await deactivateCustomer(customerId, orgId, orgSlug)
          if (res.error) { setError(res.error); return }
          window.location.reload()
        } catch {
          setError('An error occurred. Please try again.')
        }
      })
    } catch {
      // ignore
    }
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    setOpen(false)
    try {
      if (!confirm(`Permanently delete "${customerName}"? This cannot be undone.`)) return
      setError(null)
      startDelete(async () => {
        try {
          const res = await deleteCustomer(customerId, orgId, orgSlug)
          if (res.error) { setError(res.error); return }
          window.location.href = `/dashboard/${orgSlug}/customers`
        } catch {
          setError('An error occurred. Please try again.')
        }
      })
    } catch {
      // ignore
    }
  }

  const base = `/dashboard/${orgSlug}`
  const canDelete = isActive === false

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600 max-w-[200px]">{error}</span>}

      {/* Pencil — scrolls to customer details section */}
      <a
        href="#section-customer-details"
        className="inline-flex items-center justify-center rounded-md border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 transition-colors"
        title="Edit customer details"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
        </svg>
      </a>

      {/* Kebab menu */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`inline-flex items-center justify-center rounded-md border border-gray-300 p-2 text-gray-600 hover:bg-gray-50 transition-colors ${open ? 'bg-gray-100' : ''}`}
          title="More actions"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>

        {open && (
          <div
            className="absolute right-0 top-full mt-1 z-[200] w-56 rounded-lg border border-gray-200 bg-white shadow-xl py-1"
            onClick={(e) => e.stopPropagation()}
          >
            <SectionLabel>Create</SectionLabel>
            <MenuItem onClick={(e) => { e.stopPropagation(); nav(`${base}/quotes/new`) }}>Quote</MenuItem>
            <MenuItem onClick={(e) => { e.stopPropagation(); nav(`${base}/sales-orders`) }}>Sales Order</MenuItem>
            <MenuItem onClick={(e) => { e.stopPropagation(); nav(`${base}/invoices`) }}>Invoice</MenuItem>
            <MenuItem dimmed title="Coming soon">Payment</MenuItem>
            <MenuItem onClick={(e) => { e.stopPropagation(); nav(`${base}/jobs`) }}>Job</MenuItem>
            <MenuItem dimmed title="Coming soon">Sales Lead</MenuItem>

            <Divider />
            <MenuItem dimmed title="Coming soon">Send Invoice Statements</MenuItem>
            <MenuItem dimmed title="Coming soon">Enable Customer Portal</MenuItem>

            {isOwnerOrAdmin && (
              <>
                <Divider />
                <MenuItem dimmed title="Coming soon">Merge Customer</MenuItem>
                {isActive !== false ? (
                  <MenuItem onClick={handleDeactivate} dimmed={deactivatePending}>
                    {deactivatePending ? 'Disabling…' : 'Disable Customer'}
                  </MenuItem>
                ) : (
                  <MenuItem onClick={(e) => { e.stopPropagation(); nav(`${base}/customers/${customerId}`) }}>
                    Enable Customer
                  </MenuItem>
                )}
                {canDelete ? (
                  <MenuItem red onClick={handleDelete} dimmed={deletePending}>
                    {deletePending ? 'Deleting…' : 'Delete Customer'}
                  </MenuItem>
                ) : (
                  <MenuItem dimmed title="Disable customer first to enable deletion">
                    Delete Customer
                  </MenuItem>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
