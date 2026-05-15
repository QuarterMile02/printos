'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'

type Result = {
  id: string
  result_type: string       // 'customer' | 'contact'
  display_name: string
  company_name: string | null
  phone: string | null
  customer_id: string
  url: string
  status: string | null
  customer_name: string | null
}

const STATUS_BADGE: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-600',
  prospect: 'bg-yellow-50 text-yellow-700',
  closable: 'bg-blue-50 text-blue-700',
  sold: 'bg-green-50 text-green-700',
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
    </svg>
  )
}

export default function PhoneLookup() {
  const pathname = usePathname()
  const slugMatch = pathname?.match(/\/dashboard\/([^/]+)/)
  const orgSlug = slugMatch?.[1]

  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [searched, setSearched] = useState(false)
  const [dropTop, setDropTop] = useState(0)

  useEffect(() => setMounted(true), [])

  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openPanel() {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setDropTop(rect.bottom + 6)
    }
    setOpen(true)
  }

  const closePanel = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResults([])
    setActiveIdx(-1)
    setSearched(false)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      const t = e.target as Node
      if (
        panelRef.current && !panelRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) closePanel()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, closePanel])

  useEffect(() => {
    if (!open) return
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') closePanel()
    }
    document.addEventListener('keydown', handle)
    return () => document.removeEventListener('keydown', handle)
  }, [open, closePanel])

  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const digits = query.replace(/\D/g, '')
    if (digits.length < 2) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/phone-lookup?q=${encodeURIComponent(query)}`, { cache: 'no-store' })
        const data: Result[] = await res.json()
        setResults(data)
        setActiveIdx(-1)
        setSearched(true)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, open])

  // Always navigate to the parent customer page — never a contact-specific URL
  function openCustomer(r: Result) {
    const url = `/dashboard/${r.customer_id ? (r.url.match(/\/dashboard\/([^/]+)\//)?.[1] ?? orgSlug) : orgSlug}/customers/${r.customer_id}`
    window.open(url, '_blank')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = activeIdx >= 0 ? results[activeIdx] : results[0]
      if (target) openCustomer(target)
    }
  }

  const digits = query.replace(/\D/g, '')
  const addNewUrl = orgSlug ? `/dashboard/${orgSlug}/customers?new=1` : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? closePanel() : openPanel()}
        title="Phone lookup"
        aria-label="Phone lookup"
        className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${
          open ? 'bg-qm-lime-light text-qm-lime' : 'text-qm-gray hover:bg-qm-surface hover:text-qm-black'
        }`}
      >
        <PhoneIcon className="h-5 w-5" />
      </button>

      {/* Panel — portalled to document.body so no parent transform/overflow clips it */}
      {open && mounted && createPortal(
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            top: dropTop,
            left: 228,
            zIndex: 9999,
            width: 360,
          }}
          className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden"
        >
          {/* Search input */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 focus-within:border-qm-lime focus-within:ring-1 focus-within:ring-qm-lime">
              <PhoneIcon className="h-4 w-4 text-gray-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                inputMode="tel"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a phone number…"
                className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none placeholder-gray-400"
              />
              {loading && (
                <svg className="h-4 w-4 text-gray-400 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
            {digits.length === 1 && (
              <p className="mt-1.5 text-xs text-gray-400">Type at least 2 digits to search</p>
            )}
          </div>

          {/* Results + Add New (shown once 2+ digits typed) */}
          {digits.length >= 2 && !loading && (
            <div className="border-t border-gray-100">
              {/* Result rows */}
              {results.length > 0 && (
                <ul role="listbox" className="max-h-72 overflow-y-auto">
                  {results.map((r, i) => (
                    <li key={`${r.result_type}-${r.id}`} role="option" aria-selected={i === activeIdx}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIdx(i)}
                        onClick={() => openCustomer(r)}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-sm text-left transition-colors ${
                          i === activeIdx ? 'bg-qm-lime-light' : 'hover:bg-gray-50'
                        }`}
                      >
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          i === activeIdx ? 'bg-qm-lime text-white' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {(r.result_type === 'contact' ? r.customer_name : r.display_name)?.[0]?.toUpperCase() ?? '?'}
                        </span>
                        <span className="min-w-0 flex-1">
                          {r.result_type === 'contact' ? (
                            <>
                              <span className="block font-semibold text-gray-900 truncate">{r.customer_name}</span>
                              <span className="block text-xs text-gray-500 truncate">→ {r.display_name}</span>
                            </>
                          ) : (
                            <>
                              <span className="block font-semibold text-gray-900 truncate">{r.display_name}</span>
                              {r.company_name && (
                                <span className="block text-xs text-gray-500 truncate">{r.company_name}</span>
                              )}
                            </>
                          )}
                          <span className="flex items-center gap-2 mt-0.5">
                            {r.phone && <span className="text-xs text-qm-gray font-mono">{r.phone}</span>}
                            {r.status && (
                              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                {r.status}
                              </span>
                            )}
                          </span>
                        </span>
                        <svg className="mt-1 h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* No-results message */}
              {searched && results.length === 0 && (
                <div className="px-4 py-3 text-center">
                  <p className="text-sm text-gray-500">
                    No customer found for <span className="font-mono font-medium">{digits}</span>
                  </p>
                </div>
              )}

              {/* Add New Customer — always pinned at bottom once 2+ digits typed */}
              {addNewUrl && (
                <div className={results.length > 0 ? 'border-t border-gray-100' : ''}>
                  <button
                    type="button"
                    onClick={() => window.open(addNewUrl, '_blank')}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-qm-lime hover:bg-qm-lime-light transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add New Customer
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="border-t border-gray-100 px-4 py-2 bg-gray-50">
            <p className="text-xs text-gray-400">↑↓ navigate · click or Enter opens in new tab · Esc to close</p>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
