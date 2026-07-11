import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/permissions'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string; orgSlug: string; userId: string; role: Role }

type JobRow = { id: string; title: string; due_date: string }

function timeUntil(dueIso: string): { label: string; urgent: boolean } {
  const diff = new Date(dueIso).getTime() - Date.now()
  const h    = Math.floor(diff / 3_600_000)
  const m    = Math.floor((diff % 3_600_000) / 60_000)
  return {
    label:  h > 0 ? `Due in ${h}h ${m}m` : `Due in ${m}m`,
    urgent: h < 2,
  }
}

export default async function ApproachingDeadlineWidget({ service, orgId, orgSlug, userId, role }: Props) {
  try {
    const now   = new Date().toISOString()
    const in24h = new Date(Date.now() + 24 * 3_600_000).toISOString()

    let query = service
      .from('jobs')
      .select('id, title, due_date')
      .eq('organization_id', orgId)
      .in('department', ['design', 'branding'])
      .not('status', 'in', '(completed,cancelled)')
      .gte('due_date', now)
      .lte('due_date', in24h)
      .order('due_date', { ascending: true })
      .limit(5)

    if (role === 'designer') {
      query = query.eq('assigned_to', userId)
    }

    const { data, error } = await query as { data: JobRow[] | null; error: unknown }

    if (error) {
      console.error('[approaching-deadline] query error:', error)
      return null
    }
    if (!data || data.length === 0) return null

    return (
      <WidgetCard title="⚠ Approaching Deadlines" span={6}>
        <ul className="space-y-1.5">
          {data.map((j) => {
            const { label, urgent } = timeUntil(j.due_date)
            return (
              <li key={j.id}>
                <Link
                  href={`/dashboard/${orgSlug}/jobs/${j.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 transition hover:bg-amber-100"
                >
                  <span className="flex-1 truncate text-sm font-medium text-[#1A1A1A]">{j.title}</span>
                  <span className={`flex-shrink-0 text-xs font-bold ${urgent ? 'text-red-600' : 'text-amber-600'}`}>
                    {label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
        <Link
          href={`/dashboard/${orgSlug}/jobs?department=design`}
          className="mt-3 block text-right text-xs font-semibold text-[#93ca3b] hover:underline"
        >
          View all →
        </Link>
      </WidgetCard>
    )
  } catch {
    return null
  }
}
