import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { JobStatus, JobFlag } from '@/types/database'
import JobDetailClient from './job-detail-client'

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type PageProps = {
  params: Promise<{ slug: string; jobId: string }>
}

export default async function JobDetailPage({ params }: PageProps) {
  const { slug, jobId } = await params
  const supabase = await createClient()

  // Fetch org
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  // Fetch job with customer and source quote
  type JobRow = {
    id: string
    job_number: number
    title: string
    description: string | null
    status: JobStatus
    flag: JobFlag | null
    due_date: string | null
    source_quote_id: string | null
    created_at: string
    updated_at: string
    customers: {
      first_name: string
      last_name: string
      company_name: string | null
      email: string | null
      phone: string | null
    } | null
  }

  const { data: job } = await supabase
    .from('jobs')
    .select('id, job_number, title, description, status, flag, due_date, source_quote_id, created_at, updated_at, customers(first_name, last_name, company_name, email, phone)')
    .eq('id', jobId)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: JobRow | null; error: unknown }

  if (!job) notFound()

  // If source quote exists, fetch its number
  let sourceQuoteNumber: number | null = null
  if (job.source_quote_id) {
    const { data: quote } = await supabase
      .from('quotes')
      .select('quote_number')
      .eq('id', job.source_quote_id)
      .maybeSingle() as { data: { quote_number: number } | null; error: unknown }
    sourceQuoteNumber = quote?.quote_number ?? null
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* Back button + Breadcrumbs */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <a href={`/dashboard/${slug}/jobs`} className="hover:text-gray-700">Jobs</a>
          <span>/</span>
          <span className="text-gray-700">#{job.job_number}</span>
        </div>
        <a
          href={`/dashboard/${slug}/jobs`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-qm-gray hover:text-qm-black transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Jobs
        </a>
      </div>

      {/* Job Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-extrabold text-qm-black">Job #{job.job_number}</h1>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${JOB_STATUS_COLORS[job.status]}`}>
                {JOB_STATUS_LABELS[job.status]}
              </span>
              {job.flag && (
                <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  job.flag === 'file_error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {job.flag === 'file_error' ? 'File Error' : 'Help Needed'}
                </span>
              )}
            </div>
            <p className="text-lg font-medium text-qm-black">{job.title}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-qm-gray">
          <span>Created {formatDate(job.created_at)}</span>
          {job.due_date && <span>Due {formatDate(job.due_date)}</span>}
          {job.updated_at !== job.created_at && <span>Updated {formatDate(job.updated_at)}</span>}
        </div>
      </div>

      {/* Source Quote Link */}
      {job.source_quote_id && sourceQuoteNumber && (
        <div className="mb-6 rounded-lg border border-qm-lime/30 bg-qm-lime-light px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 text-qm-lime-dark" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
            </svg>
            <span className="text-sm text-qm-lime-dark">
              Created from{' '}
              <a href={`/dashboard/${slug}/quotes`} className="font-semibold underline hover:no-underline">
                Quote #{sourceQuoteNumber}
              </a>
              {' '}on approval
            </span>
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column: Details + Notes */}
        <div className="lg:col-span-2 space-y-6">
          {/* Job Details / Notes — client component for editing + voice input */}
          <JobDetailClient
            jobId={job.id}
            orgId={org.id}
            orgSlug={slug}
            description={job.description}
            flag={job.flag}
          />

          {/* Activity Timeline */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-qm-black mb-4">Activity</h2>
            <div className="relative pl-6 space-y-4">
              <div className="absolute left-2 top-1 bottom-1 w-px bg-gray-200" />

              <div className="relative">
                <div className="absolute -left-[17px] top-1 h-3 w-3 rounded-full bg-qm-lime border-2 border-white" />
                <p className="text-sm text-qm-black font-medium">Job created</p>
                <p className="text-xs text-qm-gray">{formatDate(job.created_at)}</p>
              </div>

              {job.source_quote_id && sourceQuoteNumber && (
                <div className="relative">
                  <div className="absolute -left-[17px] top-1 h-3 w-3 rounded-full bg-qm-lime border-2 border-white" />
                  <p className="text-sm text-qm-black font-medium">Auto-created from Quote #{sourceQuoteNumber}</p>
                  <p className="text-xs text-qm-gray">{formatDate(job.created_at)}</p>
                </div>
              )}

              {job.flag && (
                <div className="relative">
                  <div className={`absolute -left-[17px] top-1 h-3 w-3 rounded-full border-2 border-white ${
                    job.flag === 'file_error' ? 'bg-red-500' : 'bg-amber-500'
                  }`} />
                  <p className="text-sm text-qm-black font-medium">
                    Flagged: {job.flag === 'file_error' ? 'File Error' : 'Help Needed'}
                  </p>
                </div>
              )}

              {job.status !== 'new' && (
                <div className="relative">
                  <div className="absolute -left-[17px] top-1 h-3 w-3 rounded-full bg-qm-fuchsia border-2 border-white" />
                  <p className="text-sm text-qm-black font-medium">Status: {JOB_STATUS_LABELS[job.status]}</p>
                  <p className="text-xs text-qm-gray">{formatDate(job.updated_at)}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column: Customer + Meta */}
        <div className="space-y-6">
          {/* Customer Info */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-qm-black mb-4">Customer</h2>
            {job.customers ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-qm-black">
                    {job.customers.first_name} {job.customers.last_name}
                  </p>
                  {job.customers.company_name && (
                    <p className="text-xs text-qm-gray">{job.customers.company_name}</p>
                  )}
                </div>
                {job.customers.email && (
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                    </svg>
                    <a href={`mailto:${job.customers.email}`} className="text-sm text-qm-lime hover:underline">
                      {job.customers.email}
                    </a>
                  </div>
                )}
                {job.customers.phone && (
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-qm-gray" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                    </svg>
                    <a href={`tel:${job.customers.phone}`} className="text-sm text-qm-lime hover:underline">
                      {job.customers.phone}
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-qm-gray">No customer linked</p>
            )}
          </div>

          {/* Job Meta */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-base font-bold text-qm-black mb-4">Details</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-qm-gray">Status</dt>
                <dd><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${JOB_STATUS_COLORS[job.status]}`}>{JOB_STATUS_LABELS[job.status]}</span></dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-qm-gray">Job Number</dt>
                <dd className="font-medium text-qm-black">#{job.job_number}</dd>
              </div>
              {job.due_date && (
                <div className="flex justify-between">
                  <dt className="text-qm-gray">Due Date</dt>
                  <dd className="font-medium text-qm-black">{formatDate(job.due_date)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-qm-gray">Created</dt>
                <dd className="font-medium text-qm-black">{formatDate(job.created_at)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  )
}
