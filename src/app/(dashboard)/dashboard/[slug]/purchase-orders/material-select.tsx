'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export type Material = {
  id: string
  name: string
  cost: number
  buying_units: string | null
  selling_units: string | null
  po_description: string | null
}

type Props = {
  value: string
  onChange: (text: string) => void
  onSelectMaterial: (material: Material) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

const fmtCost = (n: number) =>
  Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

// Description field for PO line items: a plain text input that also
// searches the materials catalog as you type (same debounced
// search-and-dropdown pattern as the vendor select in
// create-po-button.tsx). Picking a match prefills description +
// unit_cost via onSelectMaterial; the text stays freely editable
// afterward for one-off line items that aren't tied to any material.
//
// The dropdown is rendered via a portal into document.body with
// fixed positioning computed from the input's rect, rather than as
// an absolutely-positioned child of the input's wrapper: this field
// sits inside the line-items table's `overflow-x-auto` wrapper, and
// per the CSS overflow spec, setting overflow-x without overflow-y
// forces the browser to compute overflow-y as auto too — silently
// clipping any in-flow absolutely-positioned dropdown to the row's
// height instead of letting it float below the input.
export function MaterialSelect({ value, onChange, onSelectMaterial, onKeyDown, placeholder, autoFocus, className }: Props) {
  const [results, setResults] = useState<Material[]>([])
  const [showDrop, setShowDrop] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value.trim()) {
      setResults([])
      return
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/materials?search=${encodeURIComponent(value.trim())}`)
      setResults(res.ok ? await res.json() : [])
    }, 250)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setShowDrop(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const open = showDrop && results.length > 0

  useEffect(() => {
    if (!open) return
    const updatePos = () => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (rect) setPos({ top: rect.bottom, left: rect.left, width: rect.width })
    }
    updatePos()
    window.addEventListener('scroll', updatePos, true)
    window.addEventListener('resize', updatePos)
    return () => {
      window.removeEventListener('scroll', updatePos, true)
      window.removeEventListener('resize', updatePos)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setShowDrop(true) }}
        onFocus={() => setShowDrop(true)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Description or search materials…'}
        className={className ?? 'w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-qm-lime'}
      />
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="z-50 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto"
        >
          {results.map((m) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={() => { onSelectMaterial(m); setShowDrop(false) }}
              className="w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              <span className="font-medium text-gray-900 truncate">{m.name}</span>
              <span className="text-gray-400 text-xs shrink-0">
                {fmtCost(m.cost)}{m.buying_units ? ` / ${m.buying_units}` : ''}
              </span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
