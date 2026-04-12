import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { JobStatus, JobFlag } from '@/types/database'
import KanbanBoard, { type JobCard } from './kanban-board'

type PageProps = { params: Promise<{ slug: string }> }

export default async function JobsPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // Fetch org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  // Fetch jobs with joined customer data
  type JobRow = {
    id: string
    job_number: number
    title: string
    status: JobStatus
    flag: JobFlag | null
    due_date: string | null
    customer_id: string | null
    customers: {
      first_name: string
      last_name: string
      company_name: string | null
    } | null
  }

  const { data: jobRows } = await supabase
    .from('jobs')
    .select('id, job_number, title, status, flag, due_date, customer_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .order('job_number', { ascending: false }) as { data: JobRow[] | null; error: unknown }

  const jobs: JobCard[] = (jobRows ?? []).map((r) => ({
    id: r.id,
    job_number: r.job_number,
    title: r.title,
    status: r.status,
    flag: r.flag,
    due_date: r.due_date,
    customer: r.customers ?? null,
  }))

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
            {total === 0 ? 'No jobs yet.' : `${total} job${total === 1 ? '' : 's'}`}
          </p>
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
        <KanbanBoard jobs={jobs} orgId={org.id} orgSlug={org.slug} />
      )}
    </div>
  )
}
