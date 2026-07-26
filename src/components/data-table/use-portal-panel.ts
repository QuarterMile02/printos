'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface PanelPosition {
  top: number
  right: number  // distance from viewport right edge (for CSS `right`)
}

/**
 * Shared hook for portal-rendered dropdown panels.
 * Returns refs for the trigger button and panel div, tracks open state,
 * computes fixed viewport position on open/scroll/resize, and handles
 * outside-click and Escape to close.
 */
export function usePortalPanel() {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<PanelPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Safe to use document/window only after mount (avoids SSR issues)
  useEffect(() => { setMounted(true) }, [])

  const recalc = useCallback(() => {
    if (!triggerRef.current) return
    const r = triggerRef.current.getBoundingClientRect()
    setPos({
      top: r.bottom + 4,                 // 4px gap below trigger (≈ mt-1)
      right: window.innerWidth - r.right, // align panel's right edge to trigger's right edge
    })
  }, [])

  // Recalculate on scroll (capture phase catches nested scroll containers) and resize
  useEffect(() => {
    if (!open) return
    recalc()
    window.addEventListener('scroll', recalc, true)
    window.addEventListener('resize', recalc)
    return () => {
      window.removeEventListener('scroll', recalc, true)
      window.removeEventListener('resize', recalc)
    }
  }, [open, recalc])

  // Outside click → close
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Escape key → close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return { open, setOpen, mounted, triggerRef, panelRef, pos }
}
