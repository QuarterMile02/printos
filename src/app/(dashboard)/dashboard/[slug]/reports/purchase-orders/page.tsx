import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import ReportShell from '../report-shell'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string; page?: string }>
}

export default async function PurchaseOrdersReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[reports-purchase-orders] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (reports-purchase-orders)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
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
      title="Purchase Orders"
      totalRows={0}
      page={1}
      pageCount={1}
    >
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
        <p className="text-sm font-medium text-gray-700">Purchase orders are not yet enabled.</p>
        <p className="mt-1 text-sm text-gray-500">
          This report will show POs to vendors once the purchase orders module is activated.
        </p>
      </div>
    </ReportShell>
  )
}
