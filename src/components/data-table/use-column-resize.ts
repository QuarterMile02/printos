'use client'

import { useState, useCallback, useEffect, useRef } from 'react'

interface Options {
  defaultWidths: Record<string, number>
  savedWidths: Record<string, number>
  onWidthCommit?: (column: string, width: number) => void
  disabled?: boolean
}

export function useColumnResize({ defaultWidths, savedWidths, onWidthCommit, disabled }: Options) {
  const [widths, setWidths] = useState<Record<string, number>>(() => ({
    ...defaultWidths,
    ...savedWidths,
  }))

  // Re-sync when a view is loaded (savedWidths reference changes)
  const prevSaved = useRef(savedWidths)
  useEffect(() => {
    if (savedWidths !== prevSaved.current) {
      prevSaved.current = savedWidths
      setWidths({ ...defaultWidths, ...savedWidths })
    }
  }, [savedWidths, defaultWidths])

  const resizing = useRef<{
    column: string
    startX: number
    startWidth: number
  } | null>(null)

  const startResize = useCallback(
    (column: string, e: React.MouseEvent) => {
      if (disabled) return
      e.preventDefault()
      e.stopPropagation()
      const startWidth = widths[column] ?? defaultWidths[column] ?? 100
      resizing.current = { column, startX: e.clientX, startWidth }

      const onMove = (ev: MouseEvent) => {
        if (!resizing.current) return
        const delta = ev.clientX - resizing.current.startX
        const w = Math.max(60, resizing.current.startWidth + delta)
        setWidths((prev) => ({ ...prev, [resizing.current!.column]: w }))
      }

      const onUp = (ev: MouseEvent) => {
        if (!resizing.current) return
        const delta = ev.clientX - resizing.current.startX
        const w = Math.max(60, resizing.current.startWidth + delta)
        onWidthCommit?.(resizing.current.column, w)
        resizing.current = null
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [disabled, widths, defaultWidths, onWidthCommit],
  )

  return { widths, startResize }
}
