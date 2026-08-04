import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { REPORT_DEFS, type ReportType } from '@/lib/reports/report-utils'
import ReportStub from '../report-stub'
import { renderPageError } from '@/lib/page-error'

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
    return renderPageError('reports-type', err)
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
