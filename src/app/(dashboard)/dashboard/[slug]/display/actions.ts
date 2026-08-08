'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { CREW_BOARDS, MANAGEMENT_UNITS } from './board-config'

const orgIdCache = new Map<string, string>()

export async function getOrgId(slug: string): Promise<string | null> {
  if (orgIdCache.has(slug)) return orgIdCache.get(slug)!

  const service = createServiceClient()
  const { data } = await service
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle() as { data: { id: string } | null; error: unknown }

  if (data?.id) {
    orgIdCache.set(slug, data.id)
    return data.id
  }
  return null
}

// CREW_BOARDS / MANAGEMENT_UNITS moved to ./board-config.ts -- this file
// has 'use server' at the top, which means every export here must be an
// async Server Function; the two were plain constants and broke the
// client bundle that imported them (see board-config.ts's header comment
// for the full story). Deliberately NOT re-exported from here even as a
// pass-through -- a 'use server' file's export list applies to re-exports
// too, so that would just reintroduce the same crash. Import them from
// './board-config' directly (ManagementBoard.tsx, DepartmentBoard.tsx
// already do).

export type DisplayJob = {
  id: string
  job_number: number
  department: string | null
  status: string
  proof_status: string | null
  due_date: string | null
  description: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  customer: {
    company_name: string | null
    first_name: string
    last_name: string
  } | null
}

export async function getDisplayJobs(orgId: string, deptCodes: string[]): Promise<DisplayJob[]> {
  try {
    const service = createServiceClient()

    type JobRow = {
      id: string
      job_number: number
      department: string | null
      status: string
      proof_status: string | null
      due_date: string | null
      description: string | null
      created_at: string
      updated_at: string
      completed_at: string | null
      customer_id: string | null
    }

    const { data: jobs, error } = await service
      .from('jobs')
      .select('id, job_number, department, status, proof_status, due_date, description, created_at, updated_at, completed_at, customer_id')
      .eq('organization_id', orgId)
      .in('department', deptCodes)
      .neq('status', 'completed')
      .neq('status', 'cancelled')
      .neq('status', 'void')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(200) as { data: JobRow[] | null; error: { message: string } | null }

    if (error || !jobs) return []

    const customerIds = [...new Set(jobs.map(j => j.customer_id).filter((id): id is string => !!id))]
    const customerMap = new Map<string, { company_name: string | null; first_name: string; last_name: string }>()

    if (customerIds.length > 0) {
      const { data: customers } = await service
        .from('customers')
        .select('id, company_name, first_name, last_name')
        .in('id', customerIds) as {
          data: { id: string; company_name: string | null; first_name: string; last_name: string }[] | null
          error: unknown
        }
      for (const c of customers ?? []) {
        customerMap.set(c.id, { company_name: c.company_name, first_name: c.first_name, last_name: c.last_name })
      }
    }

    return jobs.map(job => ({
      id: job.id,
      job_number: job.job_number,
      department: job.department,
      status: job.status,
      proof_status: job.proof_status,
      due_date: job.due_date,
      description: job.description,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at,
      customer: job.customer_id ? (customerMap.get(job.customer_id) ?? null) : null,
    }))
  } catch {
    return []
  }
}

export type DisplayStats = {
  total_jobs: number
  not_started: number
  in_progress: number
  due_today: number
  overdue: number
  completed_today: number
  avg_completion_hours: number | null
  oldest_active_job_hours: number | null
  est_hours_remaining: number | null
}

export async function getDisplayStats(orgId: string, deptCodes: string[]): Promise<DisplayStats | null> {
  try {
    const service = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    type ActiveJob = { status: string; due_date: string | null; created_at: string }
    type CompletedJob = { created_at: string; completed_at: string | null; updated_at: string }

    let activeQuery = service
      .from('jobs')
      .select('status, due_date, created_at')
      .eq('organization_id', orgId)
      .neq('status', 'completed')
      .neq('status', 'cancelled')
      .neq('status', 'void')

    let completedQuery = service
      .from('jobs')
      .select('created_at, completed_at, updated_at')
      .eq('organization_id', orgId)
      .eq('status', 'completed')
      .gte('updated_at', thirtyDaysAgo)

    if (deptCodes.length > 0) {
      activeQuery = activeQuery.in('department', deptCodes)
      completedQuery = completedQuery.in('department', deptCodes)
    }

    const [activeRes, completedRes] = await Promise.all([
      activeQuery as unknown as Promise<{ data: ActiveJob[] | null; error: unknown }>,
      completedQuery as unknown as Promise<{ data: CompletedJob[] | null; error: unknown }>,
    ])

    const activeJobs = activeRes.data ?? []
    const completedJobs = completedRes.data ?? []

    const notStarted = activeJobs.filter(j => j.status === 'new').length
    const inProgress = activeJobs.filter(j => j.status === 'in_progress').length
    const dueToday = activeJobs.filter(j => j.due_date === today).length
    const overdue = activeJobs.filter(j => j.due_date != null && j.due_date < today).length

    const completedToday = completedJobs.filter(j =>
      j.completed_at?.slice(0, 10) === today || j.updated_at?.slice(0, 10) === today
    ).length

    let avgCompletionHours: number | null = null
    const validCompleted = completedJobs.filter(j => j.created_at && (j.completed_at || j.updated_at))
    if (validCompleted.length > 0) {
      const totalHours = validCompleted.reduce((sum, j) => {
        const end = new Date(j.completed_at || j.updated_at || j.created_at).getTime()
        const start = new Date(j.created_at).getTime()
        return sum + Math.max(0, end - start) / 3600000
      }, 0)
      avgCompletionHours = Math.round((totalHours / validCompleted.length) * 10) / 10
    }

    let oldestActiveJobHours: number | null = null
    if (activeJobs.length > 0) {
      const nowMs = Date.now()
      const maxHours = Math.max(...activeJobs.map(j => (nowMs - new Date(j.created_at).getTime()) / 3600000))
      oldestActiveJobHours = Math.round(maxHours * 10) / 10
    }

    return {
      total_jobs: activeJobs.length,
      not_started: notStarted,
      in_progress: inProgress,
      due_today: dueToday,
      overdue,
      completed_today: completedToday,
      avg_completion_hours: avgCompletionHours,
      oldest_active_job_hours: oldestActiveJobHours,
      est_hours_remaining: null,
    }
  } catch {
    return null
  }
}

export type CrewBoardSummary = {
  urlParam: string
  label: string
  total_jobs: number
  not_started: number
  in_progress: number
  due_today: number
  overdue: number
  completed_today: number
  oldest_active_hours: number | null
}

export type ManagementUnitSummary = {
  label: string
  color: string
  total_jobs: number
  not_started: number
  in_progress: number
  due_today: number
  overdue: number
  completed_today: number
  oldest_active_hours: number | null
}

export type DepartmentSummaries = {
  crewBoards: CrewBoardSummary[]
  managementUnits: ManagementUnitSummary[]
}

function computeStats(
  jobs: { department: string | null; status: string; due_date: string | null; created_at: string }[],
  done: { department: string | null; completed_at: string | null; updated_at: string }[],
  codes: readonly string[],
  today: string,
  nowMs: number
) {
  const active = jobs.filter(j => j.department && codes.includes(j.department))
  const doneToday = done.filter(j =>
    j.department && codes.includes(j.department) &&
    (j.completed_at?.slice(0, 10) === today || j.updated_at?.slice(0, 10) === today)
  )

  let oldestHours: number | null = null
  for (const j of active) {
    const h = (nowMs - new Date(j.created_at).getTime()) / 3600000
    if (oldestHours === null || h > oldestHours) oldestHours = Math.round(h * 10) / 10
  }

  return {
    total_jobs: active.length,
    not_started: active.filter(j => j.status === 'new').length,
    in_progress: active.filter(j => j.status === 'in_progress').length,
    due_today: active.filter(j => j.due_date === today).length,
    overdue: active.filter(j => j.due_date != null && j.due_date < today).length,
    completed_today: doneToday.length,
    oldest_active_hours: oldestHours,
  }
}

export async function getDepartmentSummaries(orgId: string): Promise<DepartmentSummaries> {
  const empty = (): DepartmentSummaries => ({
    crewBoards: Object.values(CREW_BOARDS).map(b => ({
      urlParam: b.urlParam, label: b.label,
      total_jobs: 0, not_started: 0, in_progress: 0,
      due_today: 0, overdue: 0, completed_today: 0, oldest_active_hours: null,
    })),
    managementUnits: MANAGEMENT_UNITS.map(u => ({
      label: u.label, color: u.color,
      total_jobs: 0, not_started: 0, in_progress: 0,
      due_today: 0, overdue: 0, completed_today: 0, oldest_active_hours: null,
    })),
  })

  try {
    const service = createServiceClient()
    const today = new Date().toISOString().slice(0, 10)
    const nowMs = Date.now()

    type ActiveJob = { department: string | null; status: string; due_date: string | null; created_at: string }
    type DoneJob = { department: string | null; completed_at: string | null; updated_at: string }

    const [activeRes, doneRes] = await Promise.all([
      service
        .from('jobs')
        .select('department, status, due_date, created_at')
        .eq('organization_id', orgId)
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .neq('status', 'void') as unknown as Promise<{ data: ActiveJob[] | null; error: unknown }>,
      service
        .from('jobs')
        .select('department, completed_at, updated_at')
        .eq('organization_id', orgId)
        .eq('status', 'completed')
        .gte('updated_at', today + 'T00:00:00.000Z') as unknown as Promise<{ data: DoneJob[] | null; error: unknown }>,
    ])

    const activeJobs = activeRes.data ?? []
    const doneJobs = doneRes.data ?? []

    const crewBoards: CrewBoardSummary[] = Object.values(CREW_BOARDS).map(b => ({
      urlParam: b.urlParam,
      label: b.label,
      ...computeStats(activeJobs, doneJobs, b.codes, today, nowMs),
    }))

    const managementUnits: ManagementUnitSummary[] = MANAGEMENT_UNITS.map(u => ({
      label: u.label,
      color: u.color,
      ...computeStats(activeJobs, doneJobs, u.codes, today, nowMs),
    }))

    return { crewBoards, managementUnits }
  } catch {
    return empty()
  }
}
