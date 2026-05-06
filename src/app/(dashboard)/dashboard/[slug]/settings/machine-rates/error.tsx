'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('[machine-rates page error]', error)
  }, [error])

  return (
    <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem', color: '#b91c1c' }}>
        PAGE ERROR (machine-rates)
      </h1>
      <div><strong>Message:</strong> {error.message || '(empty — production-redacted; see Vercel runtime logs for digest)'}</div>
      {error.digest && <div><strong>Digest:</strong> {error.digest}</div>}
      {error.stack && (
        <>
          <div style={{ marginTop: '1rem' }}><strong>Stack:</strong></div>
          <pre style={{ fontSize: '0.75rem', overflowX: 'auto' }}>{error.stack}</pre>
        </>
      )}
      <button
        onClick={() => unstable_retry()}
        style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#93ca3b', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
      >
        Retry
      </button>
    </div>
  )
}
