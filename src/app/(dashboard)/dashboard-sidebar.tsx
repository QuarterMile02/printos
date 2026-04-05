'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'

type Props = {
  email: string
  children: React.ReactNode
}

export default function DashboardSidebar({ email, children }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close sidebar on navigation
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <>
      {/* Mobile header bar */}
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 md:hidden">
        <button
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-qm-gray hover:bg-qm-surface"
          aria-label="Open menu"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <span className="text-lg font-extrabold text-qm-lime">PrintOS</span>
      </div>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col
          transition-transform duration-200 ease-in-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          md:static md:translate-x-0 md:transition-none
        `}
      >
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <span className="text-xl font-extrabold text-qm-lime">PrintOS</span>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-qm-gray hover:text-qm-black md:hidden"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <a
            href="/dashboard"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold text-qm-black hover:bg-qm-surface"
          >
            Dashboard
          </a>
        </nav>
        <div className="p-4 border-t border-gray-200">
          <div className="mb-2 px-3 text-xs text-qm-gray truncate">{email}</div>
          {children}
        </div>
      </aside>
    </>
  )
}
