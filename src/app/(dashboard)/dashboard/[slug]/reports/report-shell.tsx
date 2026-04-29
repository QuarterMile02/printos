'use client'

// Shared shell for /reports/[type] pages. Renders breadcrumb, title,
// date-range bar with presets + custom range, an Export CSV button,
// row-count, and pagination controls. Page-specific filters slot in
// via the `extraFilters` prop. Each report's table goes into `children`.

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { DATE_PRESETS, type DateRangePreset } from '@/lib/reports/report-utils'

type Props = {
  orgSlug: string
  title: string
  totalRows: number
  page: number
  pageCount: number
  exportHref?: string  // GET URL that returns the CSV
  extraFilters?: ReactNode
  children: ReactNode
}

export default function ReportShell({
  orgSlug, title, totalRows, page, pageCount, exportHref, extraFilters, children,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const preset = (search.get('preset') as DateRangePreset | null) ?? 'last_30'
  const customStart = search.get('start') ?? ''
  const customEnd = search.get('end') ?? ''

  function setParam(patch: Record<string, string | null>) {
    const params = new URLSearchParams(search.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') params.delete(k); else params.set(k, v)
    }
    // Reset page on any filter change so we don't land past the new pageCount.
    if (!('page' in patch)) params.delete('page')
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
  }

  function gotoPage(p: number) {
    setParam({ page: String(p) })
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${orgSlug}/reports`} className="hover:text-gray-700">Reports</Link>
        <span>/</span>
        <span className="text-gray-700">{title}</span>
      </div>

      <div className="mb-4 flex items-start justify-between">
        <h1 className="text-2xl font-extrabold text-[#1A1A1A]">{title}</h1>
        {exportHref && (
          <a
            href={exportHref}
            className="inline-flex items-center gap-2 rounded-md bg-[#1A1A1A] px-4 py-2 text-sm font-semibold text-white hover:brightness-125"
            download
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </a>
        )}
      </div>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Date Range</label>
          <select
            className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={preset}
            onChange={(e) => setParam({ preset: e.target.value })}
          >
            {DATE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        {preset === 'custom' && (
          <>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">Start</label>
              <input
                type="date"
                className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={customStart}
                onChange={(e) => setParam({ start: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">End</label>
              <input
                type="date"
                className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                value={customEnd}
                onChange={(e) => setParam({ end: e.target.value })}
              />
            </div>
          </>
        )}
        {extraFilters}
        <span className="ml-auto text-xs tabular-nums text-gray-500">
          {totalRows.toLocaleString()} row{totalRows === 1 ? '' : 's'}
        </span>
      </div>

      {children}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
          <span>Page {page} of {pageCount}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => gotoPage(Math.max(1, page - 1))}
              disabled={page <= 1 || isPending}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => gotoPage(Math.min(pageCount, page + 1))}
              disabled={page >= pageCount || isPending}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
