import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import ReportShell from '../report-shell'
import { renderPageError } from '@/lib/page-error'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string; page?: string }>
}

export default async function ShipmentsReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('reports-shipments', err)
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) notFound()

  const { allowed: canRunReport } = await checkPermission(org.id, 'reports.quotes')
  if (!canRunReport) notFound()

  void sp

  return (
    <ReportShell
      orgSlug={slug}
      title="Shipments"
      totalRows={0}
      page={1}
      pageCount={1}
    >
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-gray-700">Shipment tracking is not yet enabled.</p>
        <p className="mt-1 text-sm text-gray-500">
          This report will show outbound shipments and carrier tracking once the shipments module is activated.
        </p>
      </div>
    </ReportShell>
  )
}
