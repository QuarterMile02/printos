'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import type { QuoteStatus } from '@/types/database'

type Props = {
  allStatuses: QuoteStatus[]
  salesReps: { id: string; name: string }[]
  currentStatus: string
  currentSalesRep: string
}

export default function QuotesFilters({ allStatuses, salesReps, currentStatus, currentSalesRep }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [, startTransition] = useTransition()

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(search.toString())
    if (!value || value === 'all') params.delete(key); else params.set(key, value)
    params.delete('page')
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
  }

  return (
    <>
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Status</label>
        <select
          className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          value={currentStatus}
          onChange={(e) => setParam('status', e.target.value)}
        >
          <option value="all">All</option>
          {allStatuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Sales Rep</label>
        <select
          className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          value={currentSalesRep}
          onChange={(e) => setParam('sales_rep', e.target.value)}
        >
          <option value="all">All</option>
          {salesReps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>
    </>
  )
}
