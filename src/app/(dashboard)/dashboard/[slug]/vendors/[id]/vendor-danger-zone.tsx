'use client'

import { useState, useTransition } from 'react'
import { deleteVendor, deactivateVendor } from '../actions'

type Props = {
  vendorId: string
  orgId: string
  orgSlug: string
  vendorName: string
  isActive: boolean | null
  isOwnerOrAdmin: boolean
}

export default function VendorDangerZone({ vendorId, orgId, orgSlug, vendorName, isActive, isOwnerOrAdmin }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [deactivatePending, startDeactivate] = useTransition()
  const [deletePending, startDelete] = useTransition()

  function handleDeactivate() {
    if (!confirm(`Deactivate "${vendorName}"? They will be hidden from active lists but all linked materials are preserved.`)) return
    setError(null)
    startDeactivate(async () => {
      const res = await deactivateVendor(vendorId, orgId, orgSlug)
      if (res.error) { setError(res.error); return }
      window.location.reload()
    })
  }

  function handleDelete() {
    if (!confirm(`Permanently delete "${vendorName}"? This cannot be undone.`)) return
    setError(null)
    startDelete(async () => {
      const res = await deleteVendor(vendorId, orgId, orgSlug)
      if (res.error) { setError(res.error); return }
      window.location.href = `/dashboard/${orgSlug}/vendors`
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
            {deactivatePending ? 'Deactivating…' : 'Deactivate Vendor'}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deletePending}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {deletePending ? 'Deleting…' : 'Delete Vendor'}
        </button>
      </div>
    </div>
  )
}
