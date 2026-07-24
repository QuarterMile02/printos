import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { checkPermission } from '@/lib/check-permission'
import PurchaseOrderDetailClient from './PurchaseOrderDetailClient'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string; id: string }>
}

export default async function Page({ params }: PageProps) {
  const { slug, id } = await params
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
      <div className="p-8">
        <p className="text-sm text-amber-700 bg-amber-50 rounded-xl border border-amber-200 px-4 py-3">
          You don&apos;t have permission to view purchase orders.
        </p>
      </div>
    )
  }

  const { data: po } = await supabase
    .from('purchase_orders')
    .select(`
      id, po_number, status, title, notes, subtotal, tax_total, total,
      expected_delivery_date, received_date, created_at, updated_at,
      vendor:vendors(id, name, primary_contact, primary_email, primary_phone),
      sales_order:sales_orders(id, so_number, title),
      creator:profiles!purchase_orders_created_by_fkey(id, full_name),
      purchase_order_items(id, description, quantity, unit_cost, total_cost, received_qty, sort_order)
    `)
    .eq('id', id)
    .eq('org_id', org.id)
    .single()

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
