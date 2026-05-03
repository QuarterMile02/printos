import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string; orgSlug: string }

type JobRow = {
  id: string
  job_number: number
  title: string
  created_at: string
  assigned_printer: string | null
  customers: { company_name: string | null; first_name: string; last_name: string } | null
}

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
}

function rowColor(days: number) {
  if (days >= 6)  return 'bg-red-50 hover:bg-red-100'
  if (days >= 3)  return 'bg-amber-50 hover:bg-amber-100'
  return 'bg-green-50 hover:bg-green-100'
}

function ageBadge(days: number) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold'
  if (days >= 6)  return `${base} bg-red-100 text-red-700`
  if (days >= 3)  return `${base} bg-amber-100 text-amber-700`
  return `${base} bg-green-100 text-green-700`
}

export default async function DesignQueueWidget({ service, orgId, orgSlug }: Props) {
  try {
    // Jobs currently in_progress where assigned_printer or title hints at design work.
    // Without a workflow_stage column we use a broad title/printer filter; jobs
    // with no design hint are still included so the designer can see everything
    // in their queue. Sort oldest-first so highest-urgency is at the top.
    const { data, error } = await service
      .from('jobs')
      .select('id, job_number, title, created_at, assigned_printer, customers(company_name, first_name, last_name)')
      .eq('organization_id', orgId)
      .eq('status', 'in_progress')
      .order('created_at', { ascending: true })
      .limit(20) as { data: JobRow[] | null; error: unknown }

    if (error || !data) throw new Error()

    // Filter: prefer jobs where printer or title suggests design; fall back to all
    const designJobs = data.filter(j =>
      (j.assigned_printer ?? '').toLowerCase().includes('design') ||
      j.title.toLowerCase().includes('design') ||
      j.title.toLowerCase().includes('proof') ||
      j.title.toLowerCase().includes('artwork')
    )
    const display = designJobs.length > 0 ? designJobs : data

    return (
      <WidgetCard title="Design Queue" span={12}>
        {display.length === 0 ? (
          <p className="text-sm text-green-600 font-medium">✓ Design queue is clear</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-100">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Job #</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Title</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Customer</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Received</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Waiting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {display.map((j) => {
                  const days = daysSince(j.created_at)
                  const cust = j.customers
                    ? j.customers.company_name || `${j.customers.first_name} ${j.customers.last_name}`
                    : '—'
                  const received = new Date(j.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  return (
                    <tr key={j.id} className={`transition-colors ${rowColor(days)}`}>
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#93ca3b]">
                        <Link href={`/dashboard/${orgSlug}/jobs/${j.id}`}>#{j.job_number}</Link>
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 font-medium text-[#1A1A1A]">{j.title}</td>
                      <td className="max-w-[140px] truncate px-3 py-2 text-gray-600">{cust}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{received}</td>
                      <td className="px-3 py-2">
                        <span className={ageBadge(days)}>{days}d</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </WidgetCard>
    )
  } catch {
    return (
      <WidgetCard title="Design Queue" span={12}>
        <p className="text-sm text-gray-400">Unable to load</p>
      </WidgetCard>
    )
  }
}
