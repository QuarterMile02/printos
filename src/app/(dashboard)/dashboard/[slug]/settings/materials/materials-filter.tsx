'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

type Props = {
  search: string
  lowOnly: boolean
  lowCount: number
  typeFilter: string
  distinctTypes: string[]
  basePath: string
}

export default function MaterialsFilter({ search, lowOnly, lowCount, typeFilter, distinctTypes, basePath }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  function submit(newSearch: string, newLowOnly: boolean, newType: string) {
    const url = new URL(basePath, 'http://x')
    if (newSearch) url.searchParams.set('search', newSearch)
    if (newLowOnly) url.searchParams.set('low_stock', '1')
    if (newType) url.searchParams.set('type', newType)
    startTransition(() => router.push(url.pathname + url.search))
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <input
        type="text"
        defaultValue={search}
        placeholder="Search materials…"
        onChange={(e) => submit(e.target.value, lowOnly, typeFilter)}
        className="block w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
      />
      <select
        value={typeFilter}
        onChange={(e) => submit(search, lowOnly, e.target.value)}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
      >
        <option value="">All Types</option>
        {distinctTypes.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={lowOnly}
          onChange={(e) => submit(search, e.target.checked, typeFilter)}
          className="h-4 w-4 rounded border-gray-300 accent-amber-500"
        />
        Show low stock only
        {lowCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
            {lowCount}
          </span>
        )}
      </label>
    </div>
  )
}
