'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'

export type FilterDef = {
  key: string
  label: string
  options: { value: string; label: string }[]
}

export default function ReportFilters({ filters }: { filters: FilterDef[] }) {
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
      {filters.map((f) => (
        <div key={f.key}>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">{f.label}</label>
          <select
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={search.get(f.key) ?? 'all'}
            onChange={(e) => setParam(f.key, e.target.value)}
          >
            <option value="all">All</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
    </>
  )
}
