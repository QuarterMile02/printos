import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { checkPermission } from '@/lib/check-permission'
import PurchaseOrdersPageClient from './PurchaseOrdersPageClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
}

export default async function Page({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'purchase_orders.view')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view purchase orders. Contact your organization owner to request access.
        </div>
      </div>
    )
  }

  return <PurchaseOrdersPageClient slug={slug} orgId={org.id} orgName={org.name} />
}
