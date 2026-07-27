import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { checkPermission } from '@/lib/check-permission'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { SALES_ORDERS_PAGE_SIZE } from './constants'
import SoListClient, { type SoListRow } from './so-list-client'

type PageProps = {
  params: Promise<{ slug: string }>
}

export default async function SalesOrdersPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // Auth
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

  // Org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  // User role within org
  type MemberRow = { user_id: string; role: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', org.id) as { data: MemberRow[] | null; error: unknown }

  const userRole = (memberRows ?? []).find((m) => m.user_id === userId)?.role ?? 'member'

  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')

  // SSR page-1 data — includes nested shipments(id) for shipment count badges
  const DB_SELECT = 'id, so_number, title, status, total, created_at, customer_id, customers(first_name, last_name, company_name), shipments(id)'
  const { rows: initialRows, totalCount: initialTotalCount } = await fetchDataTablePage({
    tableKey: 'sales_orders',
    orgId: org.id,
    select: DB_SELECT,
    filterRules: [],
    sortRules: [{ column: 'so_number', direction: 'desc' }],
    page: 1,
    pageSize: SALES_ORDERS_PAGE_SIZE,
  })

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
          <span>/</span>
          <span className="text-gray-700">Sales Orders</span>
        </div>
        <h1 className="text-2xl font-extrabold text-qm-black">Sales Orders</h1>
      </div>

      <SoListClient
        initialRows={initialRows as SoListRow[]}
        initialTotalCount={initialTotalCount}
        orgSlug={org.slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
        canSeePricing={canSeePricing}
      />
    </div>
  )
}
