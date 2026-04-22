'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

type BulkResult = {
  processed: number
  skipped: number
  errors: { id: string; name: string; error: string }[]
  error?: string
}

export default function BulkImportShopvoxButton({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [, startTransition] = useTransition()

  async function handleClick() {
    const ok = window.confirm(
      "This will populate recipe tables for all products with ShopVOX data. Products already marked 'printos_ready' will be skipped. Continue?",
    )
    if (!ok) return

    setLoading(true)
    try {
      const res = await fetch('/api/products/bulk-import-shopvox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId }),
      })
      const data = (await res.json()) as BulkResult
      if (!res.ok || data.error) {
        window.alert(`Bulk import failed: ${data.error ?? 'unknown error'}`)
        return
      }
      const errCount = data.errors?.length ?? 0
      let msg = `Complete: ${data.processed} processed, ${data.skipped} skipped, ${errCount} errors`
      if (errCount > 0) {
        const preview = data.errors.slice(0, 5).map((e) => `  • ${e.name}: ${e.error}`).join('\n')
        msg += `\n\n${preview}${errCount > 5 ? `\n  … +${errCount - 5} more` : ''}`
      }
      window.alert(msg)
      startTransition(() => router.refresh())
    } catch (e) {
      window.alert(`Bulk import request failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg border border-qm-fuchsia bg-white px-4 py-2 text-sm font-semibold text-qm-fuchsia hover:bg-qm-fuchsia hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? (
        <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
        </svg>
      )}
      {loading ? 'Importing…' : 'Bulk Import from ShopVOX'}
    </button>
  )
}
