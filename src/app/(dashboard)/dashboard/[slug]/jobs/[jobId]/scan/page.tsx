import { createClient } from '@/lib/supabase/server'
import { clockIn, clockOut } from './actions'

export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  new: 'New', in_progress: 'In Progress', proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup', completed: 'Completed',
}

export default async function Page({ params }: { params: Promise<{ slug: string; jobId: string }> }) {
  const { slug, jobId } = await params
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) return <div className="p-8 text-red-600 text-center">Organization not found</div>

  const { data: jobRow } = await supabase
    .from('jobs')
    .select('id, job_number, title, status')
    .eq('id', jobId)
    .eq('organization_id', org.id)
    .single()
  const job = jobRow as { id: string; job_number: number; title: string; status: string } | null
  if (!job) return <div className="p-8 text-red-600 text-center">Job not found</div>

  // Check if user is currently clocked in
  const { data: { user } } = await supabase.auth.getUser()
  let isClockedIn = false
  if (user) {
    const { data: logs } = await supabase
      .from('job_time_logs')
      .select('action')
      .eq('job_id', jobId)
      .eq('user_id', user.id)
      .order('scanned_at', { ascending: false })
      .limit(1)
    const lastAction = (logs as { action: string }[] | null)?.[0]?.action
    isClockedIn = lastAction === 'clock_in'
  }

  return (
    <div className="min-h-screen bg-qm-surface flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        {/* Job info card */}
        <div className="rounded-2xl bg-white p-6 shadow-lg text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
            {org.name}
          </p>
          <h1 className="mt-2 text-2xl font-extrabold text-gray-900">
            JOB-{String(job.job_number).padStart(4, '0')}
          </h1>
          <p className="mt-1 text-base text-gray-700">{job.title}</p>
          <div className="mt-3">
            <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
              {STATUS_LABELS[job.status] ?? job.status}
            </span>
          </div>
        </div>

        {/* Status indicator */}
        <div className={`rounded-2xl p-4 text-center text-sm font-semibold ${isClockedIn ? 'bg-green-50 text-green-700 border-2 border-green-300' : 'bg-gray-50 text-gray-500 border-2 border-gray-200'}`}>
          {isClockedIn ? '● Currently Clocked In' : '○ Not Clocked In'}
        </div>

        {/* Action buttons */}
        <div className="space-y-3">
          {!isClockedIn ? (
            <form action={clockIn}>
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="orgSlug" value={slug} />
              <input type="hidden" name="stage" value={job.status} />
              <button
                type="submit"
                className="w-full rounded-2xl bg-qm-lime py-5 text-xl font-bold text-white shadow-lg hover:brightness-110 active:scale-95 transition-transform"
              >
                Clock In
              </button>
            </form>
          ) : (
            <form action={clockOut}>
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="orgId" value={org.id} />
              <input type="hidden" name="orgSlug" value={slug} />
              <input type="hidden" name="stage" value={job.status} />
              <button
                type="submit"
                className="w-full rounded-2xl bg-qm-fuchsia py-5 text-xl font-bold text-white shadow-lg hover:brightness-110 active:scale-95 transition-transform"
              >
                Clock Out
              </button>
            </form>
          )}
        </div>

        <a href={`/dashboard/${slug}/jobs/${jobId}`} className="block text-center text-sm text-gray-400 hover:text-gray-600">
          &larr; Back to Job Detail
        </a>
      </div>
    </div>
  )
}
