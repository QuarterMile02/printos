import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { OrgRole, JobStatus, JobFlag, QuoteStatus } from '@/types/database'

const ROLE_STYLES: Record<OrgRole, string> = {
  owner:      'bg-qm-lime-light text-qm-lime',
  admin:      'bg-qm-gray-light text-qm-gray',
  designer:   'bg-qm-fuchsia-light text-qm-fuchsia',
  accountant: 'bg-amber-50 text-amber-700',
  member:     'bg-qm-black/5 text-qm-black',
  viewer:     'bg-qm-surface text-qm-gray',
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
  type JobRow = {
    id: string; job_number: number; title: string; status: JobStatus
    flag: JobFlag | null; due_date: string | null; source_quote_id: string | null
    assigned_to: string | null; needs_revision: boolean; created_at: string
    customers: { first_name: string; last_name: string; company_name: string | null } | null
  }
  type QuoteRow = {
    id: string; quote_number: number; title: string; status: QuoteStatus; created_at: string
    needs_pricing_approval: boolean; needs_rescue: boolean
    customers: { first_name: string; last_name: string; company_name: string | null } | null
  }
  type LineItemRow = { quote_id: string; quantity: number; unit_price: number }

  const customersRes = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)

  const { data: jobRows } = await supabase
    .from('jobs')
    .select('id, job_number, title, status, flag, due_date, source_quote_id, assigned_to, needs_revision, created_at, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .order('created_at', { ascending: false }) as { data: JobRow[] | null; error: unknown }

  const { data: quoteRows } = await supabase
    .from('quotes')
    .select('id, quote_number, title, status, created_at, needs_pricing_approval, needs_rescue, customers(first_name, last_name, company_name)')
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

  // Quote line item totals (grand total + per-quote map)
  const quoteIds = allQuotes.map((q) => q.id)
  let quoteTotalValue = 0
  const perQuoteTotals = new Map<string, number>()
  if (quoteIds.length > 0) {
    const { data: lineItems } = await supabase
      .from('quote_line_items')
      .select('quote_id, quantity, unit_price')
      .in('quote_id', quoteIds) as { data: LineItemRow[] | null; error: unknown }

    for (const item of lineItems ?? []) {
      const val = item.quantity * item.unit_price
      quoteTotalValue += val
      perQuoteTotals.set(item.quote_id, (perQuoteTotals.get(item.quote_id) ?? 0) + val)
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

  // Sales manager data
  const isSalesManager = role === 'admin'
  const needsPricingCount = allQuotes.filter((q) => q.needs_pricing_approval).length
  const needsRescueCount = allQuotes.filter((q) => q.needs_rescue).length

  // Open quotes = not approved, not declined
  const openQuotes = allQuotes.filter((q) => q.status === 'draft' || q.status === 'sent')

  // Approved quotes not yet converted to jobs
  const jobSourceQuoteIds = new Set(allJobs.filter((j) => j.source_quote_id).map((j) => j.source_quote_id))
  const approvedNotConverted = allQuotes.filter((q) => q.status === 'approved' && !jobSourceQuoteIds.has(q.id)).length

  // Days old helper
  const now = new Date()
  function daysOld(createdAt: string): number {
    const created = new Date(createdAt)
    return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
  }

  // Sort open quotes by days old descending (stalest first)
  const pipelineQuotes = openQuotes
    .map((q) => ({
      ...q,
      total: perQuoteTotals.get(q.id) ?? 0,
      days: daysOld(q.created_at),
    }))
    .sort((a, b) => b.days - a.days)

  // Designer data
  const isDesigner = role === 'designer'
  const myJobs = allJobs.filter((j) => j.assigned_to === user!.id)

  // File error jobs (highest priority)
  const fileErrorJobs = myJobs.filter((j) => j.flag === 'file_error')

  // Approaching deadline: due within 24h, not completed/ready_for_pickup
  const deadlineJobs = myJobs.filter((j) => {
    if (!j.due_date || j.status === 'completed' || j.status === 'ready_for_pickup') return false
    const [y, m, d] = j.due_date.split('-').map(Number)
    const due = new Date(y, m - 1, d)
    const diff = due.getTime() - now.getTime()
    return diff >= 0 && diff <= 24 * 60 * 60 * 1000
  })

  // Full queue: revisions first, then by due_date ascending (nulls last)
  const myJobQueue = [...myJobs]
    .filter((j) => j.status !== 'completed')
    .sort((a, b) => {
      if (a.needs_revision !== b.needs_revision) return a.needs_revision ? -1 : 1
      const aDate = a.due_date ?? '9999-12-31'
      const bDate = b.due_date ?? '9999-12-31'
      return aDate.localeCompare(bDate)
    })

  // Accountant data
  const isAccountant = role === 'accountant'
  const completedJobsCount = allJobs.filter((j) => j.status === 'completed').length

  // Placeholder aging buckets (invoices table not built yet)
  const agingBuckets = [
    { label: '0–30 days', count: 0, total: 0, style: 'border-gray-200 bg-white', textColor: 'text-gray-600', badgeColor: 'bg-gray-100 text-gray-700' },
    { label: '31–60 days', count: 0, total: 0, style: 'border-amber-200 bg-amber-50', textColor: 'text-amber-700', badgeColor: 'bg-amber-100 text-amber-800' },
    { label: '61–90 days', count: 0, total: 0, style: 'border-orange-200 bg-orange-50', textColor: 'text-orange-700', badgeColor: 'bg-orange-100 text-orange-800' },
    { label: '90+ days', count: 0, total: 0, style: 'border-red-200 bg-red-50', textColor: 'text-red-700', badgeColor: 'bg-red-100 text-red-800' },
  ]
  const totalOutstanding = agingBuckets.reduce((sum, b) => sum + b.total, 0)

  // Alert bar counts (owner dashboard)
  const approvedQuotes = allQuotes.filter((q) => q.status === 'approved').length
  const proofsAwaiting = allJobs.filter((j) => j.status === 'proof_review').length
  const completedNotInvoiced = allJobs.filter((j) => j.status === 'completed').length
  const overdueInvoices = 0 // No invoices table yet

  const alertItems = [
    { label: 'Approved quotes to convert', count: approvedQuotes, href: `/dashboard/${slug}/quotes` },
    { label: 'Overdue invoices', count: overdueInvoices, href: `/dashboard/${slug}/jobs` },
    { label: 'Completed jobs not invoiced', count: completedNotInvoiced, href: `/dashboard/${slug}/jobs` },
    { label: 'Proofs awaiting approval', count: proofsAwaiting, href: `/dashboard/${slug}/jobs` },
  ]
  const totalAlerts = approvedQuotes + overdueInvoices + completedNotInvoiced + proofsAwaiting
  const hasUrgent = overdueInvoices > 0
  const alertBarColor = hasUrgent
    ? 'border-red-300 bg-red-50'
    : totalAlerts > 0
      ? 'border-amber-300 bg-amber-50'
      : 'border-green-300 bg-green-50'
  const alertDotColor = hasUrgent
    ? 'bg-red-500'
    : totalAlerts > 0
      ? 'bg-amber-500'
      : 'bg-green-500'
  const alertTextColor = hasUrgent
    ? 'text-red-700'
    : totalAlerts > 0
      ? 'text-amber-700'
      : 'text-green-700'

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

      {/* Owner: Alert Bar */}
      {role === 'owner' && (
        <div className={`mb-6 rounded-xl border p-4 ${alertBarColor}`}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${alertDotColor}`} />
            <h2 className={`text-sm font-bold ${alertTextColor}`}>
              {totalAlerts === 0 ? 'All clear — nothing needs attention' : `${totalAlerts} item${totalAlerts === 1 ? '' : 's'} need${totalAlerts === 1 ? 's' : ''} attention`}
            </h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {alertItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className={`flex items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-sm transition-colors hover:bg-white ${
                  item.count > 0 ? alertTextColor + ' font-semibold' : 'text-gray-500'
                }`}
              >
                <span>{item.label}</span>
                <span className={`ml-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold ${
                  item.count > 0
                    ? (hasUrgent ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800')
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {item.count}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Owner: Quick Create Bar */}
      {role === 'owner' && (
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-qm-gray mr-1">Quick Create</span>
          <a
            href={`/dashboard/${slug}/quotes`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Quote
          </a>
          <a
            href={`/dashboard/${slug}/jobs`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Job
          </a>
          <a
            href={`/dashboard/${slug}/customers`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-qm-surface transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Customer
          </a>
        </div>
      )}

      {/* Sales Manager view */}
      {isSalesManager && (
        <>
          {/* SM: Alert cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            {/* Needs Pricing Approval */}
            <a
              href={`/dashboard/${slug}/quotes`}
              className="rounded-xl border border-qm-fuchsia/30 bg-qm-fuchsia-light p-5 shadow-sm hover:border-qm-fuchsia transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-fuchsia/10 text-qm-fuchsia">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-qm-fuchsia">Pricing Approval</h3>
              </div>
              <p className="text-3xl font-extrabold text-qm-black">{needsPricingCount}</p>
              <p className="mt-1 text-xs text-qm-gray">quotes awaiting review</p>
            </a>

            {/* Rescue List */}
            <a
              href={`/dashboard/${slug}/quotes`}
              className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm hover:border-amber-400 transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700">Rescue List</h3>
              </div>
              <p className="text-3xl font-extrabold text-qm-black">{needsRescueCount}</p>
              <p className="mt-1 text-xs text-qm-gray">quotes needing manager help</p>
            </a>

            {/* Approved → Convert */}
            <a
              href={`/dashboard/${slug}/quotes`}
              className="rounded-xl border border-qm-lime/30 bg-qm-lime-light p-5 shadow-sm hover:border-qm-lime transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime/10 text-qm-lime-dark">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-qm-lime-dark">Convert to Job</h3>
              </div>
              <p className="text-3xl font-extrabold text-qm-black">{approvedNotConverted}</p>
              <p className="mt-1 text-xs text-qm-gray">approved, no work order yet</p>
            </a>

            {/* Open Quotes */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-surface text-qm-gray">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                </div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-qm-gray">Open Quotes</h3>
              </div>
              <p className="text-3xl font-extrabold text-qm-black">{openQuotes.length}</p>
              <p className="mt-1 text-xs text-qm-gray">draft + sent</p>
            </div>
          </div>

          {/* SM: Sales Team Pipeline */}
          <div className="mb-8 rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-bold text-qm-black">Sales Team Pipeline</h2>
              <span className="text-xs font-medium text-qm-gray">{pipelineQuotes.length} open quote{pipelineQuotes.length === 1 ? '' : 's'}</span>
            </div>
            {pipelineQuotes.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-qm-gray">No open quotes in the pipeline</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">#</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Title</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Customer</th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Days Old</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pipelineQuotes.map((q) => (
                      <tr key={q.id} className="hover:bg-qm-surface/50">
                        <td className="whitespace-nowrap px-6 py-3 text-sm font-medium text-gray-500">Q-{q.quote_number}</td>
                        <td className="whitespace-nowrap px-6 py-3 text-sm font-medium text-qm-black">{q.title}</td>
                        <td className="whitespace-nowrap px-6 py-3 text-sm text-gray-500">
                          {q.customers
                            ? `${q.customers.first_name} ${q.customers.last_name}${q.customers.company_name ? ` (${q.customers.company_name})` : ''}`
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-sm font-medium text-qm-black text-right">${formatCents(q.total)}</td>
                        <td className="whitespace-nowrap px-6 py-3 text-right">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                            q.days >= 14
                              ? 'bg-red-50 text-red-700'
                              : q.days >= 7
                                ? 'bg-amber-50 text-amber-700'
                                : 'bg-qm-surface text-qm-gray'
                          }`}>
                            {q.days}d
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${QUOTE_STATUS_COLORS[q.status]}`}>
                            {q.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-3">
                          <div className="flex gap-1">
                            {q.needs_pricing_approval && (
                              <span className="inline-flex items-center rounded-full bg-qm-fuchsia-light px-2 py-0.5 text-xs font-semibold text-qm-fuchsia">Pricing</span>
                            )}
                            {q.needs_rescue && (
                              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Rescue</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Designer view */}
      {isDesigner && (
        <>
          {/* File Error Alert — highest priority, red blinking */}
          {fileErrorJobs.length > 0 && (
            <div className="mb-4 rounded-xl border-2 border-red-400 bg-red-50 p-4 animate-pulse">
              <div className="flex items-center gap-2 mb-3">
                <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
                <h2 className="text-sm font-bold text-red-700">
                  File Error — {fileErrorJobs.length} job{fileErrorJobs.length === 1 ? '' : 's'} need{fileErrorJobs.length === 1 ? 's' : ''} immediate attention
                </h2>
              </div>
              <div className="space-y-2">
                {fileErrorJobs.map((j) => (
                  <a
                    key={j.id}
                    href={`/dashboard/${slug}/jobs`}
                    className="flex items-center justify-between rounded-lg bg-white/80 px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-white transition-colors"
                  >
                    <span>Job #{j.job_number} — {j.title}</span>
                    {j.customers && (
                      <span className="text-xs font-normal text-red-500">{j.customers.first_name} {j.customers.last_name}</span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Approaching Deadline Alert */}
          {deadlineJobs.length > 0 && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                </svg>
                <h2 className="text-sm font-bold text-amber-700">
                  Due within 24 hours — {deadlineJobs.length} job{deadlineJobs.length === 1 ? '' : 's'}
                </h2>
              </div>
              <div className="space-y-2">
                {deadlineJobs.map((j) => (
                  <a
                    key={j.id}
                    href={`/dashboard/${slug}/jobs`}
                    className="flex items-center justify-between rounded-lg bg-white/70 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-white transition-colors"
                  >
                    <span>Job #{j.job_number} — {j.title}</span>
                    <span className="text-xs font-normal text-amber-500">Due {j.due_date ? formatDate(j.due_date) : ''}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* My Job Queue */}
          <div className="mb-8 rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <h2 className="text-base font-bold text-qm-black">My Job Queue</h2>
              <span className="text-xs font-medium text-qm-gray">{myJobQueue.length} active job{myJobQueue.length === 1 ? '' : 's'}</span>
            </div>
            {myJobQueue.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-qm-gray">No jobs assigned to you</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {myJobQueue.map((j) => {
                  const dueSoon = j.due_date && deadlineJobs.some((d) => d.id === j.id)
                  const isFileErr = j.flag === 'file_error'
                  let borderAccent = ''
                  if (isFileErr) borderAccent = 'border-l-4 border-l-red-500'
                  else if (j.needs_revision) borderAccent = 'border-l-4 border-l-qm-fuchsia'
                  else if (dueSoon) borderAccent = 'border-l-4 border-l-amber-500'

                  return (
                    <a
                      key={j.id}
                      href={`/dashboard/${slug}/jobs`}
                      className={`flex items-center gap-4 px-6 py-4 hover:bg-qm-surface/50 transition-colors ${borderAccent}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-qm-gray">#{j.job_number}</span>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${JOB_STATUS_COLORS[j.status]}`}>
                            {JOB_STATUS_LABELS[j.status]}
                          </span>
                          {j.needs_revision && (
                            <span className="inline-flex items-center rounded-full bg-qm-fuchsia-light px-2 py-0.5 text-xs font-semibold text-qm-fuchsia">Revision</span>
                          )}
                          {isFileErr && (
                            <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">File Error</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-qm-black truncate">{j.title}</p>
                        {j.customers && (
                          <p className="text-xs text-qm-gray mt-0.5">
                            {j.customers.first_name} {j.customers.last_name}
                            {j.customers.company_name && <span> · {j.customers.company_name}</span>}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        {j.due_date ? (
                          <span className={`text-xs font-medium ${dueSoon ? 'text-amber-600' : 'text-qm-gray'}`}>
                            {dueSoon ? 'Due today' : formatDate(j.due_date)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">No due date</span>
                        )}
                      </div>
                    </a>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Accountant view */}
      {isAccountant && (
        <>
          {/* Total Outstanding */}
          <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-qm-gray">Total Outstanding</h2>
                <p className="mt-1 text-4xl font-extrabold text-qm-black">${formatCents(totalOutstanding)}</p>
                <p className="mt-1 text-xs text-qm-gray">across all overdue invoices</p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Aging Buckets */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            {agingBuckets.map((bucket) => (
              <div
                key={bucket.label}
                className={`rounded-xl border p-5 shadow-sm ${bucket.style}`}
              >
                <h3 className={`text-xs font-semibold uppercase tracking-wide ${bucket.textColor}`}>{bucket.label}</h3>
                <p className="mt-2 text-2xl font-extrabold text-qm-black">{bucket.count}</p>
                <p className="mt-1 text-sm font-medium text-qm-black">${formatCents(bucket.total)}</p>
                <span className={`mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${bucket.badgeColor}`}>
                  {bucket.count === 0 ? 'Clear' : `${bucket.count} invoice${bucket.count === 1 ? '' : 's'}`}
                </span>
              </div>
            ))}
          </div>

          {/* Completed Jobs Not Invoiced + Collection Call List */}
          <div className="grid gap-6 lg:grid-cols-2 mb-8">
            {/* Completed Jobs Not Invoiced */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime-dark">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-qm-black">Completed Jobs — Not Invoiced</h2>
              </div>
              <p className="text-4xl font-extrabold text-qm-black">{completedJobsCount}</p>
              <p className="mt-1 text-sm text-qm-gray">
                completed job{completedJobsCount === 1 ? '' : 's'} with no invoice
              </p>
              <div className="mt-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                  </svg>
                  <p className="text-xs text-amber-700">
                    Invoices table coming soon — all completed jobs are shown as un-invoiced for now.
                  </p>
                </div>
              </div>
              {completedJobsCount > 0 && (
                <a
                  href={`/dashboard/${slug}/jobs`}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-qm-lime hover:underline"
                >
                  View completed jobs
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </a>
              )}
            </div>

            {/* Collection Call List */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-fuchsia-light text-qm-fuchsia">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-qm-black">Collection Call List</h2>
              </div>
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-qm-surface mb-4">
                  <svg className="h-7 w-7 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-qm-black">Coming Soon</p>
                <p className="mt-1 text-xs text-qm-gray max-w-xs">
                  Once the invoices module is built, this section will show a daily auto-generated list of overdue accounts that need collection calls, sorted by amount owed.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Stats cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {/* Jobs */}
        <a href={`/dashboard/${slug}/jobs`} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:border-qm-lime transition-colors">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime-dark">
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
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime-dark">
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
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime-dark">
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
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-qm-lime-light text-qm-lime-dark">
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
