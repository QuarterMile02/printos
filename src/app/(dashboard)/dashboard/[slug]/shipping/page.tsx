import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { checkPermission } from '@/lib/check-permission'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { SHIPPING_PAGE_SIZE } from './constants'
import ShippingListClient, { type ShippingListRow } from './shipping-list-client'

type PageProps = {
  params: Promise<{ slug: string }>
}

const DB_SELECT = `
  id, status, tracking_number, actual_cost, quoted_rate, carrier, created_at,
  sales_order_id, customer_id, shipping_method_id,
  sales_orders(so_number, title, created_at, customers(first_name, last_name, company_name)),
  customers(first_name, last_name, company_name),
  shipping_methods(name, carrier)
`

export default async function ShippingPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'shipping.view')
  if (!allowed) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Shipping</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view shipping.
        </div>
      </div>
    )
  }

  type MemberRow = { user_id: string; role: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', org.id) as { data: MemberRow[] | null; error: unknown }
  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const { rows: initialRows, totalCount: initialTotalCount } = await fetchDataTablePage({
    tableKey: 'shipments',
    orgId: org.id,
    select: DB_SELECT,
    filterRules: [],
    sortRules: [{ column: 'created_at', direction: 'desc' }],
    page: 1,
    pageSize: SHIPPING_PAGE_SIZE,
  })

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
            <span>/</span>
            <span className="text-gray-700">Shipping</span>
          </div>
          <h1 className="text-2xl font-extrabold text-qm-black">Shipping</h1>
        </div>
        <Link
          href={`/dashboard/${slug}/shipping/new`}
          className="rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
        >
          + New Shipment
        </Link>
      </div>

      <ShippingListClient
        initialRows={initialRows as ShippingListRow[]}
        initialTotalCount={initialTotalCount}
        orgSlug={org.slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
      />
    </div>
  )
}
