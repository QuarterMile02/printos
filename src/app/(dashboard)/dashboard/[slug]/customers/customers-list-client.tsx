'use client'

import { useState, useRef, useTransition } from 'react'
import { loadMoreCustomers, searchCustomers, type CustomerListRow } from './actions'

type Props = {
  initialRows: CustomerListRow[]
  totalCount: number
  orgSlug: string
  orgId: string
  distinctTags: string[]
  sort: string
  statusFilter: string
  typeFilter: string
  tagFilter: string
}

const STATUS_STYLES: Record<string, string> = {
  lead:      'bg-gray-100 text-gray-700',
  sold:      'bg-qm-lime-light text-qm-lime-dark',
  closable:  'bg-blue-50 text-blue-700',
  prospect:  'bg-yellow-50 text-yellow-700',
  inactive:  'bg-red-50 text-red-600',
}
const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', sold: 'Sold', closable: 'Closable', prospect: 'Prospect',
}

function Dash() { return <span className="text-gray-300">—</span> }

function buildUrl(orgSlug: string, params: { sort?: string; status?: string; type?: string; tag?: string }) {
  const sp = new URLSearchParams()
  if (params.sort && params.sort !== 'name_asc') sp.set('sort', params.sort)
  if (params.status) sp.set('status', params.status)
  if (params.type) sp.set('type', params.type)
  if (params.tag) sp.set('tag', params.tag)
  const q = sp.toString()
  return `/dashboard/${orgSlug}/customers${q ? `?${q}` : ''}`
}

const SORT_LABELS: Record<string, string> = {
  name_asc: 'Name A→Z',
  name_desc: 'Name Z→A',
  newest: 'Newest First',
}
const SORT_CYCLE: Record<string, string> = {
  name_asc: 'name_desc',
  name_desc: 'newest',
  newest: 'name_asc',
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'lead', label: 'Lead' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'closable', label: 'Closable' },
  { value: 'sold', label: 'Sold' },
  { value: 'inactive', label: 'Inactive' },
]
const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'company', label: 'Company' },
  { value: 'individual', label: 'Individual' },
]

export default function CustomersListClient({
  initialRows, totalCount, orgSlug, orgId,
  distinctTags, sort, statusFilter, typeFilter, tagFilter,
}: Props) {
  const [rows, setRows] = useState<CustomerListRow[]>(initialRows)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<CustomerListRow[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)

  const hasFilters = statusFilter || typeFilter || tagFilter
  const displayed = searchResults ?? rows

  function handleSearchChange(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const term = value.trim()
    if (term.length < 2) {
      setSearchResults(null)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    const seq = ++searchSeqRef.current
    debounceRef.current = setTimeout(async () => {
      const results = await searchCustomers(orgId, term, { status: statusFilter, type: typeFilter, tag: tagFilter })
      if (searchSeqRef.current === seq) {
        setSearchResults(results)
        setIsSearching(false)
      }
    }, 300)
  }

  const hasMore = rows.length < totalCount

  function handleLoadMore() {
    startTransition(async () => {
      const more = await loadMoreCustomers(
        orgId,
        { sort, status: statusFilter, type: typeFilter, tag: tagFilter },
        rows.length,
      )
      setRows((prev) => [...prev, ...more])
    })
  }

  if (initialRows.length === 0 && !hasFilters) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-qm-lime-light text-qm-lime-dark">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
          </svg>
        </div>
        <p className="mt-4 text-sm font-medium text-gray-900">No customers yet</p>
        <p className="mt-1 text-sm text-gray-500">Add your first customer to start tracking orders.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          {isSearching ? (
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-qm-lime animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          ) : (
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          )}
          <input
            type="text"
            placeholder="Search name, company, email, city, phone…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-400 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => window.location.href = buildUrl(orgSlug, { sort, status: e.target.value, type: typeFilter, tag: tagFilter })}
          className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => window.location.href = buildUrl(orgSlug, { sort, status: statusFilter, type: e.target.value, tag: tagFilter })}
          className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        >
          {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Tags filter */}
        {distinctTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => window.location.href = buildUrl(orgSlug, { sort, status: statusFilter, type: typeFilter, tag: e.target.value })}
            className="rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          >
            <option value="">All Tags</option>
            {distinctTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        )}

        {/* Sort toggle */}
        <a
          href={buildUrl(orgSlug, { sort: SORT_CYCLE[sort] ?? 'name_asc', status: statusFilter, type: typeFilter, tag: tagFilter })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
          </svg>
          {SORT_LABELS[sort] ?? 'Sort'}
        </a>

        {/* Clear filters */}
        {hasFilters && (
          <a
            href={buildUrl(orgSlug, { sort })}
            className="text-sm text-qm-fuchsia hover:underline"
          >
            Clear filters
          </a>
        )}
      </div>

      {/* Active filter badges */}
      {hasFilters && (
        <div className="flex flex-wrap gap-2">
          {statusFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Status: {STATUS_OPTIONS.find(o => o.value === statusFilter)?.label ?? statusFilter}
              <a href={buildUrl(orgSlug, { sort, type: typeFilter, tag: tagFilter })} className="ml-1 hover:text-qm-fuchsia">×</a>
            </span>
          )}
          {typeFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Type: {TYPE_OPTIONS.find(o => o.value === typeFilter)?.label ?? typeFilter}
              <a href={buildUrl(orgSlug, { sort, status: statusFilter, tag: tagFilter })} className="ml-1 hover:text-qm-fuchsia">×</a>
            </span>
          )}
          {tagFilter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              Tag: {tagFilter}
              <a href={buildUrl(orgSlug, { sort, status: statusFilter, type: typeFilter })} className="ml-1 hover:text-qm-fuchsia">×</a>
            </span>
          )}
        </div>
      )}

      {/* ── Table ── */}
      {displayed.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500">
          {search ? `No customers match "${search}"` : 'No customers match the current filters.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Company</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Primary Contact</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">City / State</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Terms</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayed.map((c) => {
                const href = `/dashboard/${orgSlug}/customers/${c.id}`
                const cityState = [c.city, c.state].filter(Boolean).join(', ')
                const status = c.status ?? 'lead'
                const isInactive = c.is_active === false
                return (
                  <tr key={c.id} className={`group hover:bg-gray-50 ${isInactive ? 'opacity-60' : ''}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      <a href={href} className="group-hover:text-qm-lime transition-colors">
                        {c.company_name ?? <span className="text-gray-400 font-normal">—</span>}
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      <a href={href}>{c.first_name} {c.last_name}</a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {c.phone
                        ? <a href={`tel:${c.phone}`} className="hover:underline">{c.phone}</a>
                        : <Dash />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      <a href={href}>{c.email ?? <Dash />}</a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      <a href={href}>{cityState || <Dash />}</a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <a href={href}>
                        {isInactive ? (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-red-50 text-red-600">Inactive</span>
                        ) : (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_LABELS[status] ?? status}
                          </span>
                        )}
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      <a href={href}>{c.terms ?? <Dash />}</a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Load More ── */}
      {hasMore && !searchResults && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <span className="text-sm text-gray-500">
            Showing {rows.length.toLocaleString()} of {totalCount.toLocaleString()}
          </span>
          <button
            onClick={handleLoadMore}
            disabled={isPending}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}
      {searchResults && (
        <p className="text-center text-xs text-gray-400 pt-1">
          {searchResults.length === 50 ? 'Showing top 50 matches — refine your search for more specific results.' : `${searchResults.length} result${searchResults.length === 1 ? '' : 's'} from database`}
        </p>
      )}
    </div>
  )
}
