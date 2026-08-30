'use client'

import { useState, useRef, useEffect } from 'react'

type Country = { code: string; flag: string; dial: string; label: string }

const COUNTRIES: Country[] = [
  { code: 'US', flag: '🇺🇸', dial: '+1',   label: 'United States' },
  { code: 'MX', flag: '🇲🇽', dial: '+52',  label: 'Mexico' },
  { code: 'CA', flag: '🇨🇦', dial: '+1',   label: 'Canada' },
  { code: 'BR', flag: '🇧🇷', dial: '+55',  label: 'Brazil' },
  { code: 'CO', flag: '🇨🇴', dial: '+57',  label: 'Colombia' },
  { code: 'AR', flag: '🇦🇷', dial: '+54',  label: 'Argentina' },
  { code: 'CL', flag: '🇨🇱', dial: '+56',  label: 'Chile' },
  { code: 'PE', flag: '🇵🇪', dial: '+51',  label: 'Peru' },
  { code: 'GT', flag: '🇬🇹', dial: '+502', label: 'Guatemala' },
  { code: 'SV', flag: '🇸🇻', dial: '+503', label: 'El Salvador' },
  { code: 'HN', flag: '🇭🇳', dial: '+504', label: 'Honduras' },
  { code: 'CR', flag: '🇨🇷', dial: '+506', label: 'Costa Rica' },
  { code: 'PA', flag: '🇵🇦', dial: '+507', label: 'Panama' },
  { code: 'VE', flag: '🇻🇪', dial: '+58',  label: 'Venezuela' },
  { code: 'EC', flag: '🇪🇨', dial: '+593', label: 'Ecuador' },
  { code: 'BO', flag: '🇧🇴', dial: '+591', label: 'Bolivia' },
  { code: 'PY', flag: '🇵🇾', dial: '+595', label: 'Paraguay' },
  { code: 'UY', flag: '🇺🇾', dial: '+598', label: 'Uruguay' },
  { code: 'ES', flag: '🇪🇸', dial: '+34',  label: 'Spain' },
  { code: 'GB', flag: '🇬🇧', dial: '+44',  label: 'United Kingdom' },
]

// Sort longest dial code first to avoid "+5" matching before "+52"
const SORTED_BY_DIAL = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length)

function detectCountry(value: string): Country {
  if (!value.startsWith('+')) return COUNTRIES[0]
  return SORTED_BY_DIAL.find((c) => value.startsWith(c.dial)) ?? COUNTRIES[0]
}

function stripDial(value: string, dial: string): string {
  return value.startsWith(dial) ? value.slice(dial.length) : value
}

type Props = {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  required?: boolean
  name?: string
  className?: string
  disabled?: boolean
}

export default function PhoneInput({ value, onChange, placeholder, required, name, className, disabled }: Props) {
  const detected = detectCountry(value)
  const [country, setCountry] = useState<Country>(detected)
  const [localNum, setLocalNum] = useState(() => stripDial(value, detected.dial))
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Sync state when value changes externally. This used to be a
  // useEffect keyed on [value], but that meant every controlled
  // round-trip (type a digit -> onChange -> parent setState -> new
  // value prop) cost an extra commit+re-render pass just to set the
  // exact same country/localNum right back. React's own guidance for
  // "adjusting state when a prop changes" is to do it directly during
  // render, gated on a comparison against the previous prop value --
  // React detects the setState call before committing and re-renders
  // immediately, skipping the extra effect-triggered pass entirely.
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    const det = detectCountry(value)
    setCountry(det)
    setLocalNum(stripDial(value, det.dial))
  }

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  // Focus search when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0)
  }, [open])

  const filtered = COUNTRIES.filter((c) => {
    const q = search.toLowerCase()
    return (
      c.label.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      c.dial.includes(q)
    )
  })

  function selectCountry(c: Country) {
    setCountry(c)
    setOpen(false)
    setSearch('')
    onChange(c.dial + localNum)
  }

  function handleNumChange(num: string) {
    setLocalNum(num)
    onChange(country.dial + num)
  }

  const combined = country.dial + localNum

  return (
    <div className={`flex rounded-md border border-gray-300 focus-within:border-qm-lime focus-within:ring-1 focus-within:ring-qm-lime ${disabled ? 'bg-gray-50' : ''} ${className ?? ''}`}>
      {name && <input type="hidden" name={name} value={combined} />}

      {/* Country code trigger */}
      <div ref={dropdownRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => { if (!disabled) setOpen((o) => !o) }}
          disabled={disabled}
          className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 border-r border-gray-300 hover:bg-gray-50 rounded-l-md whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:bg-transparent"
        >
          <span>{country.flag}</span>
          <span className="text-gray-500">{country.dial}</span>
          <svg className="h-3 w-3 text-gray-400 ml-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
          </svg>
        </button>

        {open && (
          <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="p-2 border-b border-gray-100">
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search country…"
                className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </div>
            <div className="max-h-52 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => selectCountry(c)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-qm-lime-light transition-colors ${c.code === country.code ? 'bg-qm-lime-light font-medium' : ''}`}
                  >
                    <span className="text-base">{c.flag}</span>
                    <span className="flex-1 truncate">{c.label}</span>
                    <span className="text-gray-400 text-xs shrink-0">{c.dial}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Local number input */}
      <input
        type="text"
        inputMode="tel"
        value={localNum}
        onChange={(e) => handleNumChange(e.target.value)}
        placeholder={placeholder ?? '1234567890'}
        required={required}
        disabled={disabled}
        className="flex-1 min-w-0 rounded-r-md px-3 py-2 text-sm focus:outline-none bg-transparent disabled:text-gray-400 disabled:cursor-not-allowed"
      />
    </div>
  )
}
