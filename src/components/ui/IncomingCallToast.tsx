'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { CallEvent } from '@/lib/dialpad-store'

const POLL_INTERVAL_MS = 3_000
const AUTO_DISMISS_MS = 30_000

export default function IncomingCallToast() {
  const [call, setCall] = useState<CallEvent | null>(null)
  // Initialize to now so we only surface calls that arrive after page load
  const sinceRef = useRef<number>(Date.now())
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showCall = useCallback((event: CallEvent) => {
    setCall(event)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
    dismissTimer.current = setTimeout(() => setCall(null), AUTO_DISMISS_MS)
  }, [])

  const dismiss = useCallback(() => {
    setCall(null)
    if (dismissTimer.current) clearTimeout(dismissTimer.current)
  }, [])

  useEffect(() => {
    let active = true

    async function poll() {
      try {
        const res = await fetch(`/api/webhooks/dialpad/stream?since=${sinceRef.current}`, {
          cache: 'no-store',
        })
        if (!res.ok || !active) return
        const events: CallEvent[] = await res.json()
        if (events.length > 0) {
          // Update watermark so we don't re-show the same event
          sinceRef.current = Math.max(...events.map((e) => e.timestamp))
          // Show the most recent call (latest timestamp)
          const latest = events.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
          showCall(latest)
        }
      } catch {
        // Network error — silently ignore, will retry on next interval
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      active = false
      clearInterval(interval)
      if (dismissTimer.current) clearTimeout(dismissTimer.current)
    }
  }, [showCall])

  if (!call) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] w-full max-w-md px-4"
    >
      <div className="flex items-center gap-3 rounded-xl bg-white border border-green-200 shadow-lg px-4 py-3 ring-1 ring-green-400/30">
        {/* Green pulse dot */}
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {call.matched ? `📞 ${call.customer_name}` : '📞 Unknown Caller'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{call.from_number}</p>
        </div>

        {call.matched && call.customer_url && (
          <a
            href={call.customer_url}
            className="shrink-0 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
          >
            View
          </a>
        )}

        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
