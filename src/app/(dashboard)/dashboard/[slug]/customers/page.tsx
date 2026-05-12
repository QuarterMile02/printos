import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import CreateCustomerForm from './create-customer-form'
import CustomersListClient from './customers-list-client'
import type { CustomerListRow } from './actions'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ sort?: string; status?: string; type?: string; tag?: string }>
}

export default async function CustomersPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const sort = sp.sort ?? 'name_asc'
  const statusFilter = sp.status ?? ''
  const typeFilter = sp.type ?? ''
  const tagFilter = sp.tag ?? ''

  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations').select('id, name, slug').eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
  if (!org) notFound()

  // ── Build filtered query (reused for count + data) ─────────────────────────

  function applyFilters(q: ReturnType<typeof supabase.from>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = q as any
    if (statusFilter === 'inactive') {
      query = query.eq('is_active', false)
    } else if (statusFilter) {
      query = query.eq('status', statusFilter)
    }
    if (typeFilter === 'company') {
      query = query.not('company_name', 'is', null).neq('company_name', '')
    } else if (typeFilter === 'individual') {
      query = query.or('company_name.is.null,company_name.eq.')
    }
    if (tagFilter) {
      query = query.contains('tags', [tagFilter])
    }
    return query
  }

  function applySort(q: ReturnType<typeof supabase.from>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = q as any
    if (sort === 'name_desc') {
      query = query.order('last_name', { ascending: false }).order('first_name', { ascending: false })
    } else if (sort === 'newest') {
      query = query.order('created_at', { ascending: false })
    } else {
      query = query.order('last_name', { ascending: true }).order('first_name', { ascending: true })
    }
    return query
  }

  // ── Fetch data, count, tags, and sales reps in parallel ───────────────────

  const baseSelect = 'id, first_name, last_name, company_name, email, phone, city, state, status, terms, is_active, tags, created_at'

  const [customersRes, countRes, tagRows, memberRows] = await Promise.all([
    applySort(
      applyFilters(
        supabase.from('customers').select(baseSelect).eq('organization_id', org.id)
      )
    ).range(0, 49),

    applyFilters(
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('organization_id', org.id)
    ),

    supabase
      .from('customers')
      .select('tags')
      .eq('organization_id', org.id)
      .limit(2000),

    supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', org.id)
      .in('role', ['owner', 'admin', 'member']),
  ])

  const customers = (customersRes.data ?? []) as CustomerListRow[]
  const totalCount = countRes.count ?? 0

  // Flatten + dedupe tags
  const distinctTags = [...new Set(
    ((tagRows.data ?? []) as { tags: string[] | null }[]).flatMap((r) => r.tags ?? [])
  )].filter(Boolean).sort()

  // Fetch profiles for org members
  type ProfileRow = { id: string; full_name: string | null }
  type MemberRow = { user_id: string; role: string }
  const userIds = ((memberRows.data ?? []) as MemberRow[]).map((m) => m.user_id)
  let salesReps: ProfileRow[] = []
  if (userIds.length > 0) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds) as { data: ProfileRow[] | null; error: unknown }
    salesReps = (profileData ?? []).sort((a, b) =>
      (a.full_name ?? '').localeCompare(b.full_name ?? '')
    )
  }

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
              {totalCount === 0 ? 'No customers yet.' : `${totalCount.toLocaleString()} customer${totalCount === 1 ? '' : 's'}`}
            </p>
          </div>
          <CreateCustomerForm orgId={org.id} orgSlug={org.slug} salesReps={salesReps} />
        </div>
      </div>

      <CustomersListClient
        key={`${sort}-${statusFilter}-${typeFilter}-${tagFilter}`}
        initialRows={customers}
        totalCount={totalCount}
        orgSlug={slug}
        orgId={org.id}
        distinctTags={distinctTags}
        sort={sort}
        statusFilter={statusFilter}
        typeFilter={typeFilter}
        tagFilter={tagFilter}
      />
    </div>
  )
}
