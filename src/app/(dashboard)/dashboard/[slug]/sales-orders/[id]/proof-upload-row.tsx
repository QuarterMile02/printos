'use client'

import { useRef, useState, useTransition } from 'react'
import { uploadProofForLineItem } from './proof-actions'

type ButtonProps = {
  soId: string
  orgId: string
  orgSlug: string
  lineItemId: string
  buttonLabel?: string
  onUploaded: () => void
}

// The upload control on its own — reused by both ProofUploadRow (no
// proof exists yet for this line item) and, compactly, by the
// "already responded" row (so a staff member can upload a corrected
// version right next to the Approved/Rejected badge, without that state
// blocking re-upload entirely).
export function UploadProofButton({ soId, orgId, orgSlug, lineItemId, buttonLabel = 'Upload Proof', onUploaded }: ButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleFileChange() {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return
    setError(null)
    startTransition(async () => {
      const res = await uploadProofForLineItem(soId, orgId, orgSlug, lineItemId, file)
      if (!res.success) {
        setError(res.error ?? 'Upload failed.')
      } else {
        if (fileInputRef.current) fileInputRef.current.value = ''
        onUploaded()
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <label className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold ${isPending ? 'border-gray-200 text-gray-400' : 'border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer'}`}>
        {isPending ? 'Uploading…' : buttonLabel}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          disabled={isPending}
          onChange={handleFileChange}
          className="hidden"
        />
      </label>
      {error && <p className="max-w-[16rem] text-right text-xs text-red-600">{error}</p>}
    </div>
  )
}

type RowProps = {
  soId: string
  orgId: string
  orgSlug: string
  lineItemId: string
  lineItemLabel: string
  onUploaded: () => void
}

// Item 2 — inline upload control for one line item on the SO detail page.
// Only rendered by the parent when a job already exists for this specific
// line item (migration 121's job-per-line-item grain makes "which job"
// unambiguous); the actual resolution of soId+lineItemId -> jobId happens
// server-side in uploadProofForLineItem, never trusted from here.
export default function ProofUploadRow({ soId, orgId, orgSlug, lineItemId, lineItemLabel, onUploaded }: RowProps) {
  return (
    <div className="flex items-center gap-3 px-6 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{lineItemLabel}</p>
      </div>
      <UploadProofButton soId={soId} orgId={orgId} orgSlug={orgSlug} lineItemId={lineItemId} onUploaded={onUploaded} />
    </div>
  )
}
