// Friendly, generic error state for a data-table fetch failure. The
// technical detail is already logged via console.error by useDataTableQuery
// (client-side) or the page's own server-side fetch — this only ever shows
// the user a safe, generic message in place of a misleading empty table.
export function DataTableError() {
  return (
    <div style={{ padding: '3rem 1rem', textAlign: 'center' }}>
      <p style={{ color: '#4b5563', fontSize: '0.95rem' }}>
        Something went wrong loading this data. Please try again, or contact support if this keeps happening.
      </p>
    </div>
  )
}
