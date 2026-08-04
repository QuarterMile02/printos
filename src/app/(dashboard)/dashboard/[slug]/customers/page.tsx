import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import Link from 'next/link'
import CreateCustomerForm from './create-customer-form'
import CustomersListClient from './customers-list-client'
import { CUSTOMERS_PAGE_SIZE } from './constants'
import type { CustomerListRow } from './actions'
import { dbOrThrow } from '@/lib/db'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ sort?: string; status?: string; type?: string; tag?: string; new?: string }>
}

export default async function CustomersPage(props: PageProps) {
  try {
    return await CustomersPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    console.error('[customers-list] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (customers-list)</h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function CustomersPageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const sort = sp.sort ?? 'name_asc'
  const statusFilter = sp.status ?? ''
  const typeFilter = sp.type ?? ''
  const tagFilter = sp.tag ?? ''

  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
  if (!org) notFound()

  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id ?? ''

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
      query = query
        .order('company_name', { ascending: false, nullsFirst: true })
        .order('last_name', { ascending: false })
        .order('first_name', { ascending: false })
    } else if (sort === 'newest') {
      query = query.order('created_at', { ascending: false })
    } else {
      query = query
        .order('company_name', { ascending: true, nullsFirst: false })
        .order('last_name', { ascending: true })
        .order('first_name', { ascending: true })
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
    ).limit(CUSTOMERS_PAGE_SIZE),

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
      .eq('organization_id', org.id),
  ])

  const customers = (customersRes.data ?? []) as CustomerListRow[]
  const totalCount = countRes.count ?? 0

  // Flatten + dedupe tags
  const distinctTags = [...new Set(
    ((tagRows.data ?? []) as { tags: string[] | null }[]).flatMap((r) => r.tags ?? [])
  )].filter(Boolean).sort()

  // Derive current user's role from the unfiltered member list
  type MemberRow = { user_id: string; role: string }
  const allMembers = (memberRows.data ?? []) as MemberRow[]
  const userRole = allMembers.find((m) => m.user_id === userId)?.role ?? 'member'

  // Sales-rep dropdown: only roles that can own work (not viewers)
  type ProfileRow = { id: string; full_name: string | null }
  const salesRepUserIds = allMembers
    .filter((m) => ['owner', 'admin', 'member'].includes(m.role))
    .map((m) => m.user_id)
  let salesReps: ProfileRow[] = []
  if (salesRepUserIds.length > 0) {
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', salesRepUserIds) as { data: ProfileRow[] | null; error: unknown }
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
            <h1 className="text-2xl font-extrabold text-qm-black">Customers</h1>
            <p className="mt-1 text-sm text-gray-500">
              {totalCount === 0 ? 'No customers yet.' : `${totalCount.toLocaleString()} customer${totalCount === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/${slug}/customers/import`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Import CSV
            </Link>
            <CreateCustomerForm orgId={org.id} orgSlug={org.slug} salesReps={salesReps} initialOpen={sp.new === '1'} />
          </div>
        </div>
      </div>

      <CustomersListClient
        initialRows={customers}
        initialTotalCount={totalCount}
        orgSlug={slug}
        orgId={org.id}
        userId={userId}
        userRole={userRole}
        distinctTags={distinctTags}
        sort={sort}
        statusFilter={statusFilter}
        typeFilter={typeFilter}
        tagFilter={tagFilter}
      />
    </div>
  )
}
