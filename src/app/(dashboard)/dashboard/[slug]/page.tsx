import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { OrgRole, JobStatus, QuoteStatus } from '@/types/database'

const ROLE_STYLES: Record<OrgRole, string> = {
  owner:  'bg-qm-lime-light text-qm-lime',
  admin:  'bg-qm-gray-light text-qm-gray',
  member: 'bg-qm-black/5 text-qm-black',
  viewer: 'bg-qm-surface text-qm-gray',
}

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: 'New',
  in_progress: 'In Progress',
  proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup',
  completed: 'Completed',
}

const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  new:              'bg-qm-lime-light text-qm-lime',
  in_progress:      'bg-qm-fuchsia-light text-qm-fuchsia',
  proof_review:     'bg-qm-gray-light text-qm-gray',
  ready_for_pickup: 'bg-qm-black/5 text-qm-black',
  completed:        'bg-qm-lime-light text-qm-lime',
}

const JOB_BAR_COLORS: Record<JobStatus, string> = {
  new:              'bg-qm-lime',
  in_progress:      'bg-qm-fuchsia',
  proof_review:     'bg-qm-gray',
  ready_for_pickup: 'bg-qm-black',
  completed:        'bg-qm-lime',
}

const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = {
  draft:    'bg-qm-gray-light text-qm-gray',
  sent:     'bg-qm-fuchsia-light text-qm-fuchsia',
  approved: 'bg-qm-lime-light text-qm-lime',
  declined: 'bg-red-50 text-red-700',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type PageProps = { params: Promise<{ slug: string }> }

export default async function OrgDashboardPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Fetch org
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  // Fetch role
  type MemberRow = { role: OrgRole }
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user!.id)
    .single() as { data: MemberRow | null; error: unknown }

  const role = membership?.role ?? 'viewer'

  // Fetch counts and data
  type JobRow = { id: string; job_number: number; title: string; status: JobStatus; created_at: string }
  type QuoteRow = { id: string; quote_number: number; title: string; status: QuoteStatus; created_at: string }
  type LineItemRow = { quote_id: string; quantity: number; unit_price: number }

  const customersRes = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)

  const { data: jobRows } = await supabase
    .from('jobs')
    .select('id, job_number, title, status, created_at')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: false }) as { data: JobRow[] | null; error: unknown }

  const { data: quoteRows } = await supabase
    .from('quotes')
    .select('id, quote_number, title, status, created_at')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: false }) as { data: QuoteRow[] | null; error: unknown }

  const membersRes = await supabase
    .from('organization_members')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)

  const customerCount = customersRes.count ?? 0
  const memberCount = membersRes.count ?? 0
  const allJobs = jobRows ?? []
  const allQuotes = quoteRows ?? []

  // Job status breakdown
  const jobsByStatus = new Map<JobStatus, number>()
  for (const job of allJobs) {
    jobsByStatus.set(job.status, (jobsByStatus.get(job.status) ?? 0) + 1)
  }

  // Quote line item totals
  const quoteIds = allQuotes.map((q) => q.id)
  let quoteTotalValue = 0
  if (quoteIds.length > 0) {
    const { data: lineItems } = await supabase
      .from('quote_line_items')
      .select('quote_id, quantity, unit_price')
      .in('quote_id', quoteIds) as { data: LineItemRow[] | null; error: unknown }

    for (const item of lineItems ?? []) {
      quoteTotalValue += item.quantity * item.unit_price
    }
  }

  // Recent activity: last 5 jobs & quotes combined, sorted by date
  type ActivityItem = {
    id: string
    type: 'job' | 'quote'
    number: number
    title: string
    status: string
    statusColor: string
    created_at: string
  }

  const recentJobs: ActivityItem[] = allJobs.slice(0, 5).map((j) => ({
    id: j.id,
    type: 'job',
    number: j.job_number,
    title: j.title,
    status: JOB_STATUS_LABELS[j.status],
    statusColor: JOB_STATUS_COLORS[j.status],
    created_at: j.created_at,
  }))

  const recentQuotes: ActivityItem[] = allQuotes.slice(0, 5).map((q) => ({
    id: q.id,
    type: 'quote',
    number: q.quote_number,
    title: q.title,
    status: q.status.charAt(0).toUpperCase() + q.status.slice(1),
    statusColor: QUOTE_STATUS_COLORS[q.status],
    created_at: q.created_at,
  }))

  const recentActivity = [...recentJobs, ...recentQuotes]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5)

  // Active jobs = not completed
  const activeJobs = allJobs.filter((j) => j.status !== 'completed').length

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-qm-gray mb-2">
          <a href="/dashboard" className="hover:text-qm-lime">Dashboard</a>
          <span>/</span>
          <span className="text-qm-black">{org.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold uppercase text-qm-black">{org.name}</h1>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${ROLE_STYLES[role]}`}>
            {role}
          </span>
        </div>
        <p className="mt-1 text-sm text-qm-gray">/{org.slug}</p>
      </div>

      {/* Stats cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {/* Jobs */}
        <a href={`/dashboard/${slug}/jobs`} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-qm-lime transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.15v4.073a2.25 2.25 0 0 1-2.25 2.25h-12a2.25 2.25 0 0 1-2.25-2.25V6a2.25 2.25 0 0 1 2.25-2.25h4.5" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 3.75a2.625 2.625 0 1 1 0 5.25 2.625 2.625 0 0 1 0-5.25Z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-qm-gray">Jobs</h2>
          </div>
          <p className="text-3xl font-extrabold text-qm-black">{allJobs.length}</p>
          <p className="mt-1 text-sm text-qm-gray">
            {activeJobs} active
          </p>
        </a>

        {/* Quotes */}
        <a href={`/dashboard/${slug}/quotes`} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-qm-lime transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-qm-gray">Quotes</h2>
          </div>
          <p className="text-3xl font-extrabold text-qm-black">{allQuotes.length}</p>
          <p className="mt-1 text-sm text-qm-gray">
            ${formatCents(quoteTotalValue)} total value
          </p>
        </a>

        {/* Customers */}
        <a href={`/dashboard/${slug}/customers`} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-qm-lime transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-qm-gray">Customers</h2>
          </div>
          <p className="text-3xl font-extrabold text-qm-black">{customerCount}</p>
          <p className="mt-1 text-sm text-qm-gray">total customers</p>
        </a>

        {/* Team Members */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-qm-gray">Team Members</h2>
          </div>
          <p className="text-3xl font-extrabold text-qm-black">{memberCount}</p>
          <p className="mt-1 text-sm text-qm-gray">total members</p>
        </div>
      </div>

      {/* Bottom section: Job breakdown + Recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Job status breakdown */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-qm-black mb-4">Jobs by Status</h2>
          {allJobs.length === 0 ? (
            <p className="text-sm text-qm-gray py-4 text-center">No jobs yet</p>
          ) : (
            <div className="space-y-3">
              {(Object.keys(JOB_STATUS_LABELS) as JobStatus[]).map((status) => {
                const count = jobsByStatus.get(status) ?? 0
                const pct = allJobs.length > 0 ? (count / allJobs.length) * 100 : 0
                return (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-qm-gray">{JOB_STATUS_LABELS[status]}</span>
                      <span className="text-sm font-semibold text-qm-black">{count}</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-qm-surface">
                      <div
                        className={`h-2 rounded-full ${JOB_BAR_COLORS[status]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-bold text-qm-black mb-4">Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-qm-gray py-4 text-center">No activity yet</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((item) => (
                <a
                  key={`${item.type}-${item.id}`}
                  href={`/dashboard/${slug}/${item.type === 'job' ? 'jobs' : 'quotes'}`}
                  className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 hover:bg-qm-surface transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-qm-gray uppercase">
                        {item.type === 'job' ? `Job #${item.number}` : `Q-${item.number}`}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${item.statusColor}`}>
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm font-medium text-qm-black truncate">{item.title}</p>
                  </div>
                  <span className="ml-4 shrink-0 text-xs text-qm-gray">{formatDate(item.created_at)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
