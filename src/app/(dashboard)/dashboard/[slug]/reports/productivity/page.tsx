import { notFound } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { resolveDateRange, type DateRangePreset } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>
}

type JobRow = {
  assigned_to: string | null
  status: string
  due_date: string | null
}

type AssigneeStat = {
  userId: string
  name: string
  total: number
  completed: number
  inProgress: number
  overdue: number
  notStarted: number
}

export default async function ProductivityReport({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('organizations').select('id, name').eq('slug', slug).maybeSingle() as { data: { id: string; name: string } | null; error: unknown }
  if (!org) notFound()

  const { allowed: canRunReport } = await checkPermission(org.id, 'reports.quotes')
  if (!canRunReport) notFound()

  const range = resolveDateRange(sp.preset as DateRangePreset | undefined, sp.start, sp.end)
  const today = new Date().toISOString().slice(0, 10)

  // Fetch team members for name resolution via service client (bypasses RLS).
  type RawMemberRow = { user_id: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)
    .in('role', ['owner', 'admin', 'member']) as { data: RawMemberRow[] | null; error: unknown }

  const memberUserIds = (memberRows ?? []).map(m => m.user_id)
  const service = createServiceClient()
  const nameById = new Map<string, string>()

  if (memberUserIds.length > 0) {
    type ProfileRow = { id: string; full_name: string | null }
    const { data: profileRows } = await service
      .from('profiles')
      .select('id, full_name')
      .in('id', memberUserIds) as { data: ProfileRow[] | null; error: unknown }
    for (const p of profileRows ?? []) {
      nameById.set(p.id, p.full_name ?? p.id)
    }
    const missing = memberUserIds.filter(id => !nameById.has(id))
    if (missing.length > 0) {
      const { data: { users: authUsers } } = await service.auth.admin.listUsers()
      for (const u of authUsers ?? []) {
        if (!nameById.has(u.id) && u.email) nameById.set(u.id, u.email)
      }
    }
  }

  const { data: jobs } = await supabase
    .from('jobs')
    .select('assigned_to, status, due_date')
    .eq('organization_id', org.id)
    .gte('created_at', range.start)
    .lte('created_at', range.end)
    .limit(2000) as { data: JobRow[] | null; error: unknown }

  const statsMap = new Map<string, AssigneeStat>()

  for (const j of jobs ?? []) {
    const userId = j.assigned_to ?? '__unassigned__'
    if (!statsMap.has(userId)) {
      statsMap.set(userId, {
        userId,
        name: userId === '__unassigned__' ? 'Unassigned' : (nameById.get(userId) ?? userId),
        total: 0, completed: 0, inProgress: 0, overdue: 0, notStarted: 0,
      })
    }
    const s = statsMap.get(userId)!
    s.total++
    if (j.status === 'completed') s.completed++
    else if (j.status === 'in_progress') s.inProgress++
    else if (j.status === 'new') s.notStarted++
    if (j.due_date && j.due_date < today && j.status !== 'completed') s.overdue++
  }

  const rows = [...statsMap.values()].sort((a, b) => b.total - a.total)

  return (
    <ReportShell
      orgSlug={slug}
      title="Productivity"
      totalRows={rows.length}
      page={1}
      pageCount={1}
      exportHref={`/api/reports/productivity?org=${org.id}`}
    >
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Team Member</th>
                <th className="px-3 py-2 text-right">Total Jobs</th>
                <th className="px-3 py-2 text-right">Completed</th>
                <th className="px-3 py-2 text-right">In Progress</th>
                <th className="px-3 py-2 text-right">Not Started</th>
                <th className="px-3 py-2 text-right">Overdue</th>
                <th className="px-3 py-2 text-right">Completion Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {rows.map((r) => {
                const rate = r.total > 0 ? Math.round((r.completed / r.total) * 100) : 0
                return (
                  <tr key={r.userId} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-[#1A1A1A]">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700 font-medium">{r.completed}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-blue-700">{r.inProgress}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.notStarted}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.overdue > 0 ? <span className="text-red-600 font-semibold">{r.overdue}</span> : <span className="text-gray-400">0</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 rounded-full bg-gray-200">
                          <div
                            className="h-full rounded-full bg-[#93ca3b]"
                            style={{ width: `${rate}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-gray-600">{rate}%</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          No jobs in this date range.
        </div>
      )}
    </ReportShell>
  )
}
