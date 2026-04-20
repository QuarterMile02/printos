import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { SalesOrderStatus } from '@/types/database'
import { checkPermission } from '@/lib/check-permission'
import SalesOrderTable from './so-table'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string }>
}

export default async function SalesOrdersPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
  if (!org) notFound()

  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')

  type SoRow = {
    id: string
    so_number: number
    title: string | null
    status: SalesOrderStatus
    total: number | null
    created_at: string
    customer_id: string | null
    quote_id: string | null
    customers: {
      first_name: string
      last_name: string
      company_name: string | null
    } | null
  }

  let query = supabase
    .from('sales_orders')
    .select('id, so_number, title, status, total, created_at, customer_id, quote_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .order('so_number', { ascending: false })

  const filterStatus = sp.status as string | undefined
  if (filterStatus && filterStatus !== 'all') {
    query = query.eq('status', filterStatus) as typeof query
  }

  const { data: rows } = await query.limit(500) as { data: SoRow[] | null; error: unknown }
  const salesOrders = (rows ?? []).map((r) => ({
    id: r.id,
    so_number: r.so_number,
    title: r.title ?? '',
    status: r.status,
    total: r.total ?? 0,
    created_at: r.created_at,
    customer: r.customers,
  }))

  const total = salesOrders.length

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
          <span>/</span>
          <span className="text-gray-700">Sales Orders</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Sales Orders</h1>
        <p className="mt-1 text-sm text-gray-500">
          {total === 0 ? 'No sales orders yet.' : `${total} sales order${total === 1 ? '' : 's'}`}
        </p>
      </div>

      <SalesOrderTable
        salesOrders={salesOrders}
        orgSlug={slug}
        activeFilter={filterStatus ?? 'all'}
        canSeePricing={canSeePricing}
      />
    </div>
  )
}
