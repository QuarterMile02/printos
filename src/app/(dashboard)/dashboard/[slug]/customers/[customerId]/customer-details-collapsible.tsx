'use client'

import { useState, useEffect } from 'react'

export default function CustomerDetailsCollapsible({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  // Auto-expand when the pencil button fires the edit event so the forms are visible
  useEffect(() => {
    function handleOpenEdit() { setOpen(true) }
    window.addEventListener('customer:open-edit', handleOpenEdit)
    return () => window.removeEventListener('customer:open-edit', handleOpenEdit)
  }, [])

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
      >
        <div className="flex-1 h-px bg-gray-200" />
        <span className="shrink-0 font-medium">
          {open ? 'Hide customer details' : 'Show all customer info'}
        </span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2.5}
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
        <div className="flex-1 h-px bg-gray-200" />
      </button>
      {open && (
        <div className="mt-4">
          {children}
        </div>
      )}
    </div>
  )
}
