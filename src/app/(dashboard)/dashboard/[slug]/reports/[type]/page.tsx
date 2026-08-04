import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { REPORT_DEFS, type ReportType } from '@/lib/reports/report-utils'
import ReportStub from '../report-stub'

// Catch-all for report types that aren't yet built out as their own
// page.tsx file. Next 15 routes a static segment (e.g. /reports/quotes)
// to its own page.tsx in preference to this dynamic one, so once a
// report is built (like quotes is), it bypasses this stub automatically.

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; type: string }> }

export default async function ReportTypePage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[reports-type] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (reports-type)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, type } = await params
  const def = REPORT_DEFS.find((r) => r.type === (type as ReportType))
  if (!def) notFound()

  const supabase = await createClient()
  const org = await dbOrThrow(
    supabase.from('organizations').select('id').eq('slug', slug).maybeSingle()
  ) as { id: string } | null
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'reports.quotes')
  if (!allowed) notFound()

  return <ReportStub orgSlug={slug} title={def.title} description={def.description} />
}
