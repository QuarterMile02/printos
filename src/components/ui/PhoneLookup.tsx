'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type Result = {
  id: string
  first_name: string
  last_name: string
  company_name: string | null
  phone: string | null
  url: string | null
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
    </svg>
  )
}

export default function PhoneLookup() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [searched, setSearched] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus input when popover opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closePopover()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on ESC globally
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closePopover()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const closePopover = useCallback(() => {
    setOpen(false)
    setQuery('')
    setResults([])
    setActiveIdx(-1)
    setSearched(false)
  }, [])

  // Debounced search
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)

    const digits = query.replace(/\D/g, '')
    if (digits.length < 4) {
      setResults([])
      setSearched(false)
      setLoading(false)
      return
    }

    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/customers/phone-lookup?q=${encodeURIComponent(query)}`, {
          cache: 'no-store',
        })
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

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, open])

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
      if (target?.url) {
        window.location.href = target.url
        closePopover()
      }
    }
  }

  const digits = query.replace(/\D/g, '')
  const showDropdown = open && (loading || query.length > 0)

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Phone lookup"
        aria-label="Phone lookup"
        className={`flex items-center justify-center rounded-md p-1.5 transition-colors ${
          open
            ? 'bg-qm-lime-light text-qm-lime'
            : 'text-qm-gray hover:bg-qm-surface hover:text-qm-black'
        }`}
      >
        <PhoneIcon className="h-5 w-5" />
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-full mt-2 z-50 w-80 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
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
            {digits.length > 0 && digits.length < 4 && (
              <p className="mt-1.5 text-xs text-gray-400">Type at least 4 digits to search</p>
            )}
          </div>

          {/* Results */}
          {showDropdown && digits.length >= 4 && !loading && (
            <div className="border-t border-gray-100">
              {results.length > 0 ? (
                <ul role="listbox">
                  {results.map((r, i) => (
                    <li key={r.id} role="option" aria-selected={i === activeIdx}>
                      <a
                        href={r.url ?? '#'}
                        onClick={closePopover}
                        onMouseEnter={() => setActiveIdx(i)}
                        className={`flex items-start gap-3 px-4 py-3 text-sm transition-colors ${
                          i === activeIdx
                            ? 'bg-qm-lime-light text-qm-black'
                            : 'hover:bg-gray-50 text-gray-900'
                        }`}
                      >
                        {/* Avatar initial */}
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                          i === activeIdx ? 'bg-qm-lime text-white' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {r.first_name?.[0]?.toUpperCase() ?? '?'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium truncate">
                            {r.first_name} {r.last_name}
                          </span>
                          {r.company_name && (
                            <span className="block text-xs text-gray-500 truncate">{r.company_name}</span>
                          )}
                          {r.phone && (
                            <span className="block text-xs text-qm-gray font-mono mt-0.5">{r.phone}</span>
                          )}
                        </span>
                        <svg className="mt-1 h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                        </svg>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : searched ? (
                <div className="px-4 py-4 text-center">
                  <p className="text-sm text-gray-500">No customer found for <span className="font-mono">{query}</span></p>
                  <button
                    type="button"
                    onClick={closePopover}
                    className="mt-1 text-sm font-medium text-qm-lime hover:underline"
                  >
                    Dismiss and add manually →
                  </button>
                </div>
              ) : null}
            </div>
          )}

          {/* Hint footer */}
          <div className="border-t border-gray-100 px-4 py-2 bg-gray-50">
            <p className="text-xs text-gray-400">↑↓ navigate · Enter to open · Esc to close</p>
          </div>
        </div>
      )}
    </div>
  )
}
