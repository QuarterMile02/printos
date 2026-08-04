// Renders a friendly, generic error message for a page-level crash. The full
// technical detail (message, stack, Postgres/PostgREST cause) is always
// logged server-side via console.error here — only the friendly copy reaches
// the actual page, so a real user isn't confronted with raw DB error text
// while the detail needed to debug it stays in the server logs.
export function renderPageError(context: string, err: unknown) {
  console.error(`[${context}] page crash:`, err)
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#111827', marginBottom: '0.5rem' }}>
        Something went wrong loading this page
      </h1>
      <p style={{ color: '#4b5563', fontSize: '0.95rem' }}>
        Please try again, or contact support if this keeps happening.
      </p>
    </div>
  )
}
