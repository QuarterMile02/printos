import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import { checkPermission } from '@/lib/check-permission'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { dbOrThrow } from '@/lib/db'
import { PURCHASE_ORDERS_PAGE_SIZE } from './constants'
import { CreatePoButton } from './create-po-button'
import PoListClient, { type PurchaseOrderListRow } from './po-list-client'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
}

const DB_SELECT = 'id, po_number, title, status, total, expected_delivery_date, received_date, created_at, vendor_id, vendors(name), sales_order_id, sales_orders(so_number, title)'

export default async function PurchaseOrdersPage(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[purchase-orders-list] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (purchase-orders-list)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string; slug: string } | null
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'purchase_orders.view')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-extrabold text-qm-black">Purchase Orders</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view purchase orders. Contact your organization owner to request access.
        </div>
      </div>
    )
  }

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type MemberRow = { user_id: string; role: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', org.id) as { data: MemberRow[] | null; error: unknown }

  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const result = await fetchDataTablePage({
    tableKey: 'purchase_orders',
    orgId: org.id,
    select: DB_SELECT,
    filterRules: [],
    sortRules: [{ column: 'po_number', direction: 'desc' }],
    page: 1,
    pageSize: PURCHASE_ORDERS_PAGE_SIZE,
  })

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-700">Purchase Orders</span>
        </div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-qm-black">Purchase Orders</h1>
          <CreatePoButton slug={slug} orgId={org.id} />
        </div>
      </div>

      <PoListClient
        initialRows={result.rows as PurchaseOrderListRow[]}
        initialTotalCount={result.totalCount}
        orgSlug={org.slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
      />
    </div>
  )
}
