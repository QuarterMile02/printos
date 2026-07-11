import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import ReportShell from '../report-shell'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string; page?: string }>
}

export default async function PurchaseOrdersReport({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id, name').eq('slug', slug).maybeSingle() as { data: { id: string; name: string } | null; error: unknown }
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
