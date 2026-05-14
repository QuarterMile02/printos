'use client'

import { useState, useRef, useTransition, useCallback } from 'react'
import { createVendor, loadMoreVendors, searchVendors, type VendorListRow } from './actions'

type Props = {
  initialRows: VendorListRow[]
  totalCount: number
  orgSlug: string
  orgId: string
}

const ic = 'block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime'

function Dash() { return <span className="text-gray-300">—</span> }

export default function VendorsListClient({ initialRows, totalCount, orgSlug, orgId }: Props) {
  const [rows, setRows] = useState<VendorListRow[]>(initialRows)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<VendorListRow[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [loadPending, startLoad] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeqRef = useRef(0)

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
      const results = await searchVendors(orgId, term)
      if (searchSeqRef.current === seq) {
        setSearchResults(results)
        setIsSearching(false)
      }
    }, 300)
  }

  // ── Create modal ─────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createPending, startCreate] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  const handleNotesTranscript = useCallback(() => {}, [])
  void handleNotesTranscript

  function handleCreate(formData: FormData) {
    setCreateError(null)
    startCreate(async () => {
      const res = await createVendor(orgId, orgSlug, formData)
      if (res.error) { setCreateError(res.error); return }
      formRef.current?.reset()
      setOpen(false)
      // Reload page to get fresh server data
      window.location.reload()
    })
  }

  // ── Search + display ─────────────────────────────────────────────────────
  const displayed = searchResults ?? rows
  const hasMore = rows.length < totalCount

  function handleLoadMore() {
    startLoad(async () => {
      const more = await loadMoreVendors(orgId, '', rows.length)
      setRows((prev) => [...prev, ...more])
    })
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
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
            placeholder="Search name, contact, email, city…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder-gray-400 focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <button
          onClick={() => { setOpen(true); setCreateError(null) }}
          className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          Add Vendor
        </button>
      </div>

      {/* Table */}
      {displayed.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No vendors found</p>
          {rows.length > 0 && <p className="mt-1 text-sm text-gray-500">Try a different search term.</p>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Company</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">City / State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {displayed.map((v) => {
                const cityState = [v.city, v.state].filter(Boolean).join(', ')
                return (
                  <tr
                    key={v.id}
                    onClick={() => { window.location.href = `/dashboard/${orgSlug}/vendors/${v.id}` }}
                    className={`cursor-pointer hover:bg-gray-50 ${v.is_active === false ? 'opacity-50' : ''}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{v.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{v.primary_contact ?? <Dash />}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {v.primary_phone
                        ? <a href={`tel:${v.primary_phone}`} className="hover:text-green-600 hover:underline">{v.primary_phone}</a>
                        : <Dash />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {v.primary_email
                        ? <a href={`mailto:${v.primary_email}`} className="hover:text-green-600 hover:underline">{v.primary_email}</a>
                        : <Dash />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">{cityState || <Dash />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Load More */}
      {hasMore && !searchResults && (
        <div className="flex items-center justify-center gap-4 pt-2">
          <span className="text-sm text-gray-500">Showing {rows.length.toLocaleString()} of {totalCount.toLocaleString()}</span>
          <button
            onClick={handleLoadMore}
            disabled={loadPending}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loadPending ? 'Loading…' : 'Load More'}
          </button>
        </div>
      )}

      {/* Add Vendor modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !createPending && setOpen(false)} />
          <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900">Add Vendor</h2>
            {createError && (
              <div className="mt-3 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{createError}</div>
            )}
            <form ref={formRef} action={handleCreate} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name <span className="text-red-500">*</span></label>
                <input name="name" type="text" required autoFocus maxLength={200} className={ic} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Primary Contact</label>
                  <input name="primary_contact" type="text" maxLength={120} className={ic} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input name="primary_phone" type="text" maxLength={30} className={ic} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input name="primary_email" type="email" maxLength={200} className={ic} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <input name="website" type="url" maxLength={200} placeholder="https://…" className={ic} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea name="notes" rows={2} maxLength={1000} className={ic} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)} disabled={createPending} className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={createPending} className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                  {createPending ? 'Saving…' : 'Add Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
