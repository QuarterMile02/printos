// My Job Assignments — jobs assigned to the logged-in user, ordered:
// (1) needs_revision rows first (red badge), (2) others by due_date asc.
// Empty state if nothing's on the list.

import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgSlug: string
  orgId: string
  userId: string
}

type Row = {
  id: string
  job_number: number
  title: string
  status: string
  due_date: string | null
  needs_revision: boolean | null
  customer_id: string | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function MyJobAssignments({ service, orgSlug, orgId, userId }: Props) {
  const { data } = await service
    .from('jobs')
    .select('id, job_number, title, status, due_date, needs_revision, customer_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', orgId)
    .eq('assigned_to', userId)
    .neq('status', 'completed')
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(15) as { data: Row[] | null; error: unknown }

  // Sort revisions to the top, preserving the date order within each group.
  const rows = (data ?? []).slice().sort((a, b) => Number(b.needs_revision ?? 0) - Number(a.needs_revision ?? 0))

  return (
    <WidgetCard title="My Job Assignments" span={6}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">No jobs assigned to you right now.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => {
            const customer = r.customers
              ? r.customers.company_name?.trim() || `${r.customers.first_name} ${r.customers.last_name}`.trim()
              : '—'
            return (
              <li key={r.id} className="py-2">
                <Link href={`/dashboard/${orgSlug}/jobs/${r.id}`} className="block hover:bg-gray-50 rounded px-2 -mx-2">
                  <div className="flex items-center gap-2">
                    {r.needs_revision && (
                      <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">Revision</span>
                    )}
                    <span className="font-mono text-xs text-gray-500">JOB-{String(r.job_number).padStart(4, '0')}</span>
                    <span className="text-sm font-medium text-[#1A1A1A] truncate flex-1">{r.title}</span>
                    <span className="text-xs text-gray-500 tabular-nums">{formatDate(r.due_date)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    <span>{customer}</span>
                    <span>·</span>
                    <span>{r.status.replace(/_/g, ' ')}</span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}
