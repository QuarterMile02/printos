'use client'

import { useRef, useState, useTransition } from 'react'
import { uploadProofForLineItem } from './proof-actions'

type Props = {
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
export default function ProofUploadRow({ soId, orgId, orgSlug, lineItemId, lineItemLabel, onUploaded }: Props) {
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
    <div className="flex items-center gap-3 px-6 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{lineItemLabel}</p>
        {error && <p className="mt-0.5 text-xs text-red-600">{error}</p>}
      </div>
      <label className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-semibold ${isPending ? 'border-gray-200 text-gray-400' : 'border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer'}`}>
        {isPending ? 'Uploading…' : 'Upload Proof'}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          disabled={isPending}
          onChange={handleFileChange}
          className="hidden"
        />
      </label>
    </div>
  )
}
