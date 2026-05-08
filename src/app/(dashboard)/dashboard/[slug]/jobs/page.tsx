import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { JobStatus, JobFlag } from '@/types/database'
import type { Role, Tier } from '@/lib/permissions'
import KanbanBoard, { type JobCard } from './kanban-board'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ department?: string }>
}

export default async function JobsPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { department: departmentParam } = await searchParams
  const supabase = await createClient()

  // Fetch org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  // Load user profile (role/tier/departments) for filtering
  const { data: { user } } = await supabase.auth.getUser()
  const service = createServiceClient()
  type ProfileRow = { role: Role; tier: Tier; departments: string[] }
  const { data: profile } = user
    ? await service
        .from('profiles')
        .select('role, tier, departments')
        .eq('id', user.id)
        .maybeSingle() as { data: ProfileRow | null; error: unknown }
    : { data: null }

  // Load departments for this org (for dropdown options)
  type DeptRow = { code: string; name: string }
  let allDepartments: DeptRow[] = []
  try {
    const { data } = await service
      .from('departments')
      .select('code, name')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }) as { data: DeptRow[] | null; error: unknown }
    allDepartments = (data ?? []).filter((d) => !!d.code)
  } catch { /* departments table may not exist */ }

  // Resolve which departments this user is scoped to. Staff tier is locked
  // to their profile.departments; lead/manager/sales/accounting/owner can
  // override via ?department=…
  const role = profile?.role ?? null
  const tier = profile?.tier ?? null
  const profileDepts = profile?.departments ?? []

  const canSeeAllDepartments =
    role === 'owner' || role === 'sales' || role === 'accounting' || tier === 'manager'
  const canChangeFilter =
    canSeeAllDepartments || tier === 'lead'

  // ?department=all => no filter (only allowed for those who can change filter).
  // ?department=<code> => only allowed if canChangeFilter and (manager/owner/sales/accounting or in profileDepts).
  // otherwise → restricted to profileDepts (staff/lead default), or all for canSeeAllDepartments.
  let activeDepartments: string[] | null = null // null = no filter
  if (canSeeAllDepartments && (!departmentParam || departmentParam === 'all')) {
    activeDepartments = null
  } else if (canChangeFilter && departmentParam && departmentParam !== 'all') {
    activeDepartments = [departmentParam]
  } else if (canChangeFilter && departmentParam === 'all') {
    activeDepartments = null
  } else {
    activeDepartments = profileDepts.length > 0 ? profileDepts : null
  }

  // Fetch jobs — scalar columns only; customer names fetched separately
  // to avoid PostgREST join failures after direct-DDL schema changes.
  type JobRow = {
    id: string
    job_number: number
    title: string
    status: JobStatus
    flag: JobFlag | null
    due_date: string | null
    customer_id: string | null
    source_quote_id: string | null
    assigned_to: string | null
    department: string | null
  }

  let jobQuery = service
    .from('jobs')
    .select('id, job_number, title, status, flag, due_date, customer_id, source_quote_id, assigned_to, department')
    .eq('organization_id', org.id)

  let countQuery = service
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)

  if (activeDepartments && activeDepartments.length > 0) {
    jobQuery = jobQuery.in('department', activeDepartments)
    countQuery = countQuery.in('department', activeDepartments) as typeof countQuery
  }

  let jobRowsData: JobRow[] | null = null
  let totalCount = 0
  const jobRes = await jobQuery.order('job_number', { ascending: false }).limit(1000) as { data: JobRow[] | null; error: { message: string } | null }
  if (jobRes.error) {
    // Any error (e.g. department column missing) — fall back without it
    const [fallback, countFb] = await Promise.all([
      service
        .from('jobs')
        .select('id, job_number, title, status, flag, due_date, customer_id, source_quote_id, assigned_to')
        .eq('organization_id', org.id)
        .order('job_number', { ascending: false })
        .limit(1000),
      service
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', org.id),
    ])
    jobRowsData = ((fallback.data ?? []) as unknown as Omit<JobRow, 'department'>[]).map((j) => ({ ...j, department: null }))
    totalCount = countFb.count ?? 0
  } else {
    jobRowsData = jobRes.data
    const cr = await countQuery
    totalCount = cr.count ?? 0
  }

  const allJobs = jobRowsData ?? []

  // Fetch customer names separately (avoids PostgREST join fragility)
  type CustomerRow = { id: string; first_name: string; last_name: string; company_name: string | null }
  const customerIds = [...new Set(allJobs.map(j => j.customer_id).filter(Boolean) as string[])]
  const customerMap = new Map<string, { first_name: string; last_name: string; company_name: string | null }>()
  if (customerIds.length > 0) {
    const { data: customerRows } = await service
      .from('customers')
      .select('id, first_name, last_name, company_name')
      .in('id', customerIds) as { data: CustomerRow[] | null; error: unknown }
    for (const c of (customerRows ?? [])) {
      customerMap.set(c.id, { first_name: c.first_name, last_name: c.last_name, company_name: c.company_name })
    }
  }

  // Fetch first line item per quote for product/dimension info
  const quoteIds = [...new Set(allJobs.map(j => j.source_quote_id).filter(Boolean) as string[])]
  const lineItemMap = new Map<string, { description: string; width: number | null; height: number | null; quantity: number }>()
  if (quoteIds.length > 0) {
    const { data: liRows } = await supabase
      .from('quote_line_items')
      .select('quote_id, description, width, height, quantity')
      .in('quote_id', quoteIds)
      .order('sort_order', { ascending: true })
    // Keep first line item per quote
    for (const li of (liRows ?? []) as { quote_id: string; description: string; width: number | null; height: number | null; quantity: number }[]) {
      if (!lineItemMap.has(li.quote_id)) lineItemMap.set(li.quote_id, li)
    }
  }

  // Fetch assigned user initials
  const assignedIds = [...new Set(allJobs.map(j => j.assigned_to).filter(Boolean) as string[])]
  const initialsMap = new Map<string, string>()
  if (assignedIds.length > 0) {
    const { data: profiles } = await supabase.from('profiles').select('id, full_name, email').in('id', assignedIds)
    for (const p of (profiles ?? []) as { id: string; full_name: string | null; email: string }[]) {
      const name = p.full_name || p.email
      const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
      initialsMap.set(p.id, initials)
    }
  }

  const jobs: JobCard[] = allJobs.map((r) => {
    const li = r.source_quote_id ? lineItemMap.get(r.source_quote_id) : undefined
    return {
      id: r.id,
      job_number: r.job_number,
      title: r.title,
      status: r.status,
      flag: r.flag,
      due_date: r.due_date,
      customer: r.customer_id ? customerMap.get(r.customer_id) ?? null : null,
      product_name: li?.description ?? null,
      width: li?.width ?? null,
      height: li?.height ?? null,
      quantity: li?.quantity ?? null,
      assigned_initials: r.assigned_to ? initialsMap.get(r.assigned_to) ?? null : null,
      department: r.department ?? null,
    }
  })

  const total = jobs.length

  return (
    <div className="flex h-full flex-col p-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
            <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
            <span>/</span>
            <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
            <span>/</span>
            <span className="text-gray-700">Jobs</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            {totalCount === 0 ? 'No jobs yet.' : `${totalCount} job${totalCount === 1 ? '' : 's'}`}
          </p>
          {total === 1000 && totalCount > 1000 && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-block">
              Showing 1000 of {totalCount} — use department filter to narrow
            </p>
          )}
        </div>
      </div>

      {/* Board */}
      {total === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white py-20">
          <div className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-qm-lime-light text-qm-lime-dark">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.073a2.25 2.25 0 0 1-2.25 2.25h-12a2.25 2.25 0 0 1-2.25-2.25V6a2.25 2.25 0 0 1 2.25-2.25h4.5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 3.75a2.625 2.625 0 1 1 0 5.25 2.625 2.625 0 0 1 0-5.25Z" />
              </svg>
            </div>
            <p className="mt-4 text-sm font-medium text-gray-900">No jobs yet</p>
            <p className="mt-1 text-sm text-gray-500">Jobs are created automatically when a Sales Order is created.</p>
          </div>
        </div>
      ) : (
        <KanbanBoard
          jobs={jobs}
          orgId={org.id}
          orgSlug={org.slug}
          allDepartments={allDepartments}
          activeDepartments={activeDepartments}
          canChangeFilter={canChangeFilter}
          canSeeAllDepartments={canSeeAllDepartments}
          currentFilter={departmentParam ?? (canSeeAllDepartments ? 'all' : '')}
        />
      )}
    </div>
  )
}
