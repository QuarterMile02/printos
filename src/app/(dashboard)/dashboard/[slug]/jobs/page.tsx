import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import type { JobStatus, JobFlag } from '@/types/database'
import type { Role, Tier } from '@/lib/permissions'
import type { JobCard } from './kanban-board'
import JobsViewToggle from './jobs-view-toggle'
import { JOBS_DB_SELECT, JOBS_PAGE_SIZE, type JobListRow } from './jobs-list-client'
import { fetchDataTablePage } from '@/lib/data-table/fetch'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ department?: string }>
}

export default async function JobsPage(props: PageProps) {
  try {
    return await JobsPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('jobs-list', err)
  }
}

async function JobsPageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { department: departmentParam } = await searchParams
  const supabase = await createClient()

  // Fetch org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null

  if (!org) notFound()

  // Load user profile (role/tier/departments) for filtering
  const { data: { user } } = await supabase.auth.getUser()
  const service = createServiceClient()
  type ProfileRow = { role: Role; tier: Tier; departments: string[] }
  const profile = user
    ? await dbOrThrow(
        service
          .from('profiles')
          .select('role, tier, departments')
          .eq('id', user.id)
          .maybeSingle()
      ) as ProfileRow | null
    : null

  // Org-membership role (owner/admin/member/viewer) -- a different concept
  // from profile.role above (sales/designer/production/etc, used for
  // department scoping). The List view's saved-views system (useSavedView)
  // needs this one, same as every other data-table page (see
  // settings/discounts/page.tsx for the identical lookup).
  type MemberRow = { user_id: string; role: string }
  const memberRows = await dbOrThrow(
    supabase.from('organization_members').select('user_id, role').eq('organization_id', org.id)
  ) as MemberRow[] | null
  const userRole = (memberRows ?? []).find((m) => m.user_id === (user?.id ?? ''))?.role ?? 'member'

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
    quote_line_item_id: string | null
    assigned_to: string | null
    department: string | null
  }

  let jobQuery = service
    .from('jobs')
    .select('id, job_number, title, status, flag, due_date, customer_id, source_quote_id, quote_line_item_id, assigned_to, department')
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
        .select('id, job_number, title, status, flag, due_date, customer_id, source_quote_id, quote_line_item_id, assigned_to')
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
    const customerRows = await dbOrThrow(
      service
        .from('customers')
        .select('id, first_name, last_name, company_name')
        .in('id', customerIds)
    ) as CustomerRow[] | null
    for (const c of (customerRows ?? [])) {
      customerMap.set(c.id, { first_name: c.first_name, last_name: c.last_name, company_name: c.company_name })
    }
  }

  // Line item for product/dimension info. Jobs created since migration 121
  // (job-per-line-item grain) have their own quote_line_item_id and look
  // themselves up directly — each card now correctly shows its own
  // product instead of whichever line item happened to sort first on the
  // quote. Older jobs (quote_line_item_id null, created before 121, back
  // when one job represented the whole SO) keep the old "first line item
  // on the quote" approximation, since there's no way to know which of
  // the quote's several line items that job was "really" for.
  type LineItemInfo = { description: string; width: number | null; height: number | null; quantity: number }
  const lineItemIds = [...new Set(allJobs.map(j => j.quote_line_item_id).filter(Boolean) as string[])]
  const lineItemById = new Map<string, LineItemInfo>()
  if (lineItemIds.length > 0) {
    const liByIdRows = await dbOrThrow(
      supabase
        .from('quote_line_items')
        .select('id, description, width, height, quantity')
        .in('id', lineItemIds)
    )
    for (const li of (liByIdRows ?? []) as { id: string; description: string; width: number | null; height: number | null; quantity: number }[]) {
      lineItemById.set(li.id, li)
    }
  }

  const quoteIdsNeedingFallback = [...new Set(
    allJobs.filter(j => !j.quote_line_item_id).map(j => j.source_quote_id).filter(Boolean) as string[]
  )]
  const lineItemMap = new Map<string, LineItemInfo>()
  if (quoteIdsNeedingFallback.length > 0) {
    const liRows = await dbOrThrow(
      supabase
        .from('quote_line_items')
        .select('quote_id, description, width, height, quantity')
        .in('quote_id', quoteIdsNeedingFallback)
        .order('sort_order', { ascending: true })
    )
    for (const li of (liRows ?? []) as { quote_id: string; description: string; width: number | null; height: number | null; quantity: number }[]) {
      if (!lineItemMap.has(li.quote_id)) lineItemMap.set(li.quote_id, li)
    }
  }

  // Fetch assigned user initials
  const assignedIds = [...new Set(allJobs.map(j => j.assigned_to).filter(Boolean) as string[])]
  const initialsMap = new Map<string, string>()
  if (assignedIds.length > 0) {
    const profiles = await dbOrThrow(
      supabase.from('profiles').select('id, full_name, email').in('id', assignedIds)
    )
    for (const p of (profiles ?? []) as { id: string; full_name: string | null; email: string }[]) {
      const name = p.full_name || p.email
      const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
      initialsMap.set(p.id, initials)
    }
  }

  const jobs: JobCard[] = allJobs.map((r) => {
    const li = r.quote_line_item_id
      ? lineItemById.get(r.quote_line_item_id)
      : (r.source_quote_id ? lineItemMap.get(r.source_quote_id) : undefined)
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

  // Initial page for the List view (JobsListClient takes over client-side
  // pagination/sort/filter/search from here — same SSR-hydration pattern
  // as settings/discounts/page.tsx).
  const listInitial = await fetchDataTablePage<JobListRow>({
    tableKey: 'jobs',
    orgId: org.id,
    select: JOBS_DB_SELECT,
    filterRules: [],
    sortRules: [{ column: 'job_number', direction: 'desc' }],
    page: 1,
    pageSize: JOBS_PAGE_SIZE,
  })

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
        <JobsViewToggle
          kanbanProps={{
            jobs,
            orgId: org.id,
            orgSlug: org.slug,
            allDepartments,
            activeDepartments,
            canChangeFilter,
            canSeeAllDepartments,
            currentFilter: departmentParam ?? (canSeeAllDepartments ? 'all' : ''),
          }}
          listProps={{
            initialRows: listInitial.error ? [] : listInitial.rows,
            initialTotalCount: listInitial.error ? 0 : listInitial.totalCount,
            orgSlug: org.slug,
            orgId: org.id,
            userId: user?.id ?? '',
            userRole,
          }}
        />
      )}
    </div>
  )
}
