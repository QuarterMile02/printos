import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import CreateCustomerForm from './create-customer-form'
import CustomersListClient from './customers-list-client'

type PageProps = { params: Promise<{ slug: string }> }

export default async function CustomersPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  type CustomerRow = {
    id: string
    first_name: string
    last_name: string
    company_name: string | null
    email: string | null
    phone: string | null
    city: string | null
    state: string | null
    status: string | null
    terms: string | null
    created_at: string
  }
  const [customersRes, countRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id, first_name, last_name, company_name, email, phone, city, state, status, terms, created_at')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id),
  ])
  const customers = (customersRes.data ?? []) as CustomerRow[]
  const totalCount = countRes.count ?? 0

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-700">Customers</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
            <p className="mt-1 text-sm text-gray-500">
              {totalCount === 0
                ? 'No customers yet.'
                : `${totalCount} customer${totalCount === 1 ? '' : 's'}`}
            </p>
            {totalCount > 1000 && (
              <p className="mt-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-block">
                Showing 1000 of {totalCount} — use search to filter
              </p>
            )}
          </div>
          <CreateCustomerForm orgId={org.id} orgSlug={org.slug} />
        </div>
      </div>

      <CustomersListClient rows={customers} orgSlug={slug} />
    </div>
  )
}
