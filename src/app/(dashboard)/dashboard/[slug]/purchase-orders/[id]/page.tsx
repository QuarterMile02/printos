import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import PurchaseOrderDetailClient from './PurchaseOrderDetailClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string; id: string }>
}

export default async function Page(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('purchase-orders-detail', err)
  }
}

async function PageInner({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'purchase_orders.view')
  if (!allowed) {
    return (
      <div className="p-8">
        <p className="text-sm text-amber-700 bg-amber-50 rounded-xl border border-amber-200 px-4 py-3">
          You don&apos;t have permission to view purchase orders.
        </p>
      </div>
    )
  }

  const po = await dbOrThrow(
    supabase
      .from('purchase_orders')
      .select(`
        id, po_number, status, title, notes, subtotal, tax_total, total,
        expected_delivery_date, received_date, created_at, updated_at,
        vendor:vendors(id, name, primary_contact, primary_email, primary_phone),
        sales_order:sales_orders(id, so_number, title),
        creator:profiles!purchase_orders_created_by_fkey(id, full_name),
        purchase_order_items(id, description, quantity, unit, unit_cost, total_cost, received_qty, sort_order, material_id)
      `)
      .eq('id', id)
      .eq('organization_id', org.id)
      .maybeSingle()
  )

  if (!po) notFound()

  return (
    <PurchaseOrderDetailClient
      slug={slug}
      orgId={org.id}
      orgName={org.name}
      initialPo={po as Parameters<typeof PurchaseOrderDetailClient>[0]['initialPo']}
    />
  )
}
