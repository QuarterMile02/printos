'use client'

import { useEffect } from 'react'

// Small delay so the image/PDF has a moment to actually load before the
// print dialog fires -- window.print() on an empty/half-loaded page is
// worse than a half-second wait.
export default function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 500)
    return () => clearTimeout(t)
  }, [])
  return null
}
