'use client'

import { useState, useMemo } from 'react'

type CustomerRow = {
  id: string
  first_name: string
  last_name: string
  company_name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: string | null
  terms: string | null
  created_at: string
}

type Props = {
  rows: CustomerRow[]
  orgSlug: string
}

const STATUS_STYLES: Record<string, string> = {
  lead:      'bg-gray-100 text-gray-700',
  sold:      'bg-qm-lime-light text-qm-lime-dark',
  closable:  'bg-blue-50 text-blue-700',
  prospect:  'bg-yellow-50 text-yellow-700',
}
const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', sold: 'Sold', closable: 'Closable', prospect: 'Prospect',
}

function Dash() { return <span className="text-gray-300">—</span> }

export default function CustomersListClient({ rows, orgSlug }: Props) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      (r.company_name ?? '').toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q) ||
      (r.city ?? '').toLowerCase().includes(q)
    )
  }, [rows, search])

  if (rows.length === 0) {
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
      {/* Search bar */}
      <div className="relative max-w-sm">
        <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <input
          type="text"
          placeholder="Search company, email, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-400 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
        />
      </div>

      {filtered.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500">No customers match &ldquo;{search}&rdquo;</p>
      )}

      {filtered.length > 0 && (
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
              {filtered.map((c) => {
                const href = `/dashboard/${orgSlug}/customers/${c.id}`
                const cityState = [c.city, c.state].filter(Boolean).join(', ')
                const status = c.status ?? 'lead'
                return (
                  <tr key={c.id} className="group hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      <a href={href} className="group-hover:text-qm-lime transition-colors">
                        {c.company_name ?? <span className="text-gray-400 font-normal">—</span>}
                      </a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                      <a href={href}>{c.first_name} {c.last_name}</a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      <a href={href}>{c.phone ?? <Dash />}</a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      <a href={href}>{c.email ?? <Dash />}</a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      <a href={href}>{cityState || <Dash />}</a>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <a href={href}>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[status] ?? status}
                        </span>
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
    </div>
  )
}
