'use client'

import { useState, useTransition } from 'react'
import { deleteCustomer, deactivateCustomer } from '../actions'

type Props = {
  customerId: string
  orgId: string
  orgSlug: string
  customerName: string
  isActive: boolean | null
  isOwnerOrAdmin: boolean
}

export default function CustomerDangerZone({ customerId, orgId, orgSlug, customerName, isActive, isOwnerOrAdmin }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [deactivatePending, startDeactivate] = useTransition()
  const [deletePending, startDelete] = useTransition()

  function handleDeactivate() {
    if (!confirm(`Deactivate "${customerName}"? They will be hidden from active lists but all linked records are preserved.`)) return
    setError(null)
    startDeactivate(async () => {
      const res = await deactivateCustomer(customerId, orgId, orgSlug)
      if (res.error) { setError(res.error); return }
      window.location.reload()
    })
  }

  function handleDelete() {
    if (!confirm(`Permanently delete "${customerName}"? This cannot be undone.`)) return
    setError(null)
    startDelete(async () => {
      const res = await deleteCustomer(customerId, orgId, orgSlug)
      if (res.error) { setError(res.error); return }
      window.location.href = `/dashboard/${orgSlug}/customers`
    })
  }

  if (!isOwnerOrAdmin) return null

  return (
    <div className="mt-6 rounded-xl border border-red-100 bg-red-50/40 p-6">
      <h2 className="text-sm font-semibold text-red-700 mb-1">Danger Zone</h2>
      <p className="text-xs text-red-500 mb-4">These actions are only available to owners and admins.</p>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-white p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex flex-wrap gap-3">
        {isActive !== false && (
          <button
            onClick={handleDeactivate}
            disabled={deactivatePending}
            className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {deactivatePending ? 'Deactivating…' : 'Deactivate Customer'}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deletePending}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {deletePending ? 'Deleting…' : 'Delete Customer'}
        </button>
      </div>
    </div>
  )
}
