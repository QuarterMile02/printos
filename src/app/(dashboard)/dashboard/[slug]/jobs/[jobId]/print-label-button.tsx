'use client'

import { useState, useTransition } from 'react'
import { markLabelPrinted } from '../actions'

type Props = {
  jobId: string
  orgId: string
  labelPrintedAt: string | null
}

export default function PrintLabelButton({ jobId, orgId, labelPrintedAt }: Props) {
  const [printed, setPrinted] = useState(labelPrintedAt)
  const [, startTransition] = useTransition()

  function handlePrint() {
    window.open(`/api/jobs/${jobId}/label`, '_blank')
    startTransition(async () => {
      const result = await markLabelPrinted(jobId, orgId)
      if (!result.error) setPrinted(new Date().toISOString())
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handlePrint}
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 active:scale-95"
      >
        {/* printer icon */}
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.054 48.054 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
        </svg>
        Print Label
      </button>
      {printed && (
        <p className="text-[10px] text-gray-400">
          Printed {new Date(printed).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>
      )}
    </div>
  )
}
