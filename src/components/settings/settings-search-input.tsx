'use client'

// Canonical settings-page search box -- the majority convention (Material
// Categories, Product Categories, Materials, Promo Codes, Discounts,
// Material Types, Product Types). Deliberately NOT Email Templates' icon
// classes, which were missing pointer-events-none (a real click-through
// bug: without it, clicking the icon itself doesn't focus/pass through to
// the input) and had no loading-spinner capability.
//
// `showSpinner` is caller-computed (typically `loading && search.length
// >= 2`, matching the live-search pages) rather than inferred here, since
// pages without live server search (Material Types, Product Types) never
// pass it and get the plain icon.

type Props = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  showSpinner?: boolean
  className?: string
}

export function SettingsSearchInput({
  value,
  onChange,
  placeholder = 'Search by name...',
  showSpinner = false,
  className = '',
}: Props) {
  return (
    <div className={`relative flex-1 min-w-[240px] ${className}`}>
      {showSpinner ? (
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
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border border-gray-300 pl-9 pr-3 py-2 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
      />
    </div>
  )
}
