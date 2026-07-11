import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'
import type { Role } from '@/lib/permissions'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string; orgSlug: string; role: Role; userDepartments: string[] }

const DEPT_LABELS: Record<string, string> = {
  large_format:      'Large Format',
  commercial_print:  'Commercial Print',
  vehicle_wrap:      'Vehicle Wrap',
  channel_letters:   'Channel Letters',
  fabrication:       'Fabrication',
  installation:      'Installation',
  service_repair:    'Service & Repair',
  digital_marketing: 'Digital Marketing',
  digital_screens:   'Digital Screens',
  branding:          'Branding',
  direct_mail:       'Direct Mail',
  promotional:       'Promotional',
  apparel:           'Apparel',
  design:            'Design',
  // Legacy fallbacks
  commercial:        'Commercial Print',
  digital:           'Digital Marketing',
}

const ACTIVE_STATUSES = ['new', 'in_progress', 'on_hold', 'pending_approval']

type JobRow = { department: string | null; due_date: string | null }

type DeptStat = { key: string; name: string; count: number; overdue: number; dueToday: number }

export default async function DepartmentQueueWidget({ service, orgId, orgSlug, role, userDepartments }: Props) {
  try {
    const todayStr    = new Date().toISOString().slice(0, 10)
    const tomorrowStr = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)

    let query = service
      .from('jobs')
      .select('department, due_date')
      .eq('organization_id', orgId)
      .in('status', ACTIVE_STATUSES)

    if (role === 'production' && userDepartments.length > 0) {
      query = query.in('department', userDepartments)
    }

    const { data, error } = await query.limit(500) as { data: JobRow[] | null; error: unknown }

    if (error) {
      console.error('[dept-queue] query error:', error)
      throw new Error()
    }

    const deptMap = new Map<string, DeptStat>()
    for (const row of data ?? []) {
      const key = row.department ?? 'unassigned'
      if (!deptMap.has(key)) {
        deptMap.set(key, {
          key,
          name: DEPT_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
          count: 0,
          overdue: 0,
          dueToday: 0,
        })
      }
      const stat = deptMap.get(key)!
      stat.count++
      if (row.due_date) {
        if (row.due_date < todayStr) stat.overdue++
        else if (row.due_date < tomorrowStr) stat.dueToday++
      }
    }

    const rows = [...deptMap.values()].sort((a, b) => b.count - a.count)

    return (
      <WidgetCard title="Department Queue" span={6}>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">No active jobs</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => {
              const tone = r.overdue > 0 ? 'red' : r.dueToday > 0 ? 'amber' : 'green'
              const dotColor  = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-400' : 'bg-[#93ca3b]'
              const badgeColor = tone === 'red'
                ? 'text-red-700 bg-red-50'
                : tone === 'amber'
                ? 'text-amber-700 bg-amber-50'
                : 'text-[#3a7a10] bg-[#93ca3b]/10'
              return (
                <li key={r.key}>
                  <Link
                    href={`/dashboard/${orgSlug}/jobs?department=${encodeURIComponent(r.key)}`}
                    className="flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 transition hover:border-gray-200 hover:bg-gray-50"
                  >
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotColor}`} />
                    <span className="flex-1 truncate text-sm font-medium text-[#1A1A1A]">{r.name}</span>
                    {r.overdue > 0 && (
                      <span className="text-xs font-semibold text-red-600">{r.overdue} overdue</span>
                    )}
                    <span className={`inline-flex min-w-[1.75rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${badgeColor}`}>
                      {r.count}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </WidgetCard>
    )
  } catch {
    return (
      <WidgetCard title="Department Queue" span={6}>
        <p className="text-sm text-gray-400">Unable to load</p>
      </WidgetCard>
    )
  }
}
