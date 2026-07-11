'use client'

import { useState, useEffect } from 'react'
import { getOrgId, getDisplayJobs, getDisplayStats, CREW_BOARDS } from './actions'
import type { DisplayJob, DisplayStats } from './actions'

const DEPT_LABELS: Record<string, string> = {
  large_format:      'Large Format',
  commercial_print:  'Commercial',
  direct_mail:       'Direct Mail',
  vehicle_wrap:      'Vehicle Wrap',
  channel_letters:   'Channel Letters',
  fabrication:       'Fabrication',
  installation:      'Installation',
  service_repair:    'Service & Repair',
  digital_marketing: 'Digital Marketing',
  digital_screens:   'Digital Screens',
  design:            'Design',
  branding:          'Branding',
  promotional:       'Promotional',
  apparel:           'Apparel',
}

const EMPTY_STATS: DisplayStats = {
  total_jobs: 0,
  not_started: 0,
  in_progress: 0,
  due_today: 0,
  overdue: 0,
  completed_today: 0,
  avg_completion_hours: null,
  oldest_active_job_hours: null,
  est_hours_remaining: null,
}

function todayStr() { return new Date().toISOString().slice(0, 10) }
function tomorrowStr() {
  const d = new Date(); d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

function jobPriority(job: DisplayJob, today: string, tomorrow: string): number {
  if (job.due_date && job.due_date < today) return 1
  if (job.due_date === today) return 2
  if (job.due_date === tomorrow) return 3
  if (job.due_date) return 4
  return 5
}

function sortJobs(jobs: DisplayJob[], today: string, tomorrow: string): DisplayJob[] {
  return [...jobs].sort((a, b) => {
    const diff = jobPriority(a, today, tomorrow) - jobPriority(b, today, tomorrow)
    if (diff !== 0) return diff
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })
}

function queueTime(createdAt: string, now: Date): { label: string; cls: string } {
  const ms = now.getTime() - new Date(createdAt).getTime()
  const totalMins = Math.floor(ms / 60000)
  const hrs = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  const days = Math.floor(hrs / 24)
  const remHrs = hrs % 24

  if (hrs < 1) return { label: `${mins}m in queue`, cls: 'text-gray-500' }
  if (hrs < 24) return { label: `${hrs}h ${mins}m in queue`, cls: 'text-gray-500' }
  if (hrs < 72) return { label: `${days}d ${remHrs}h in queue`, cls: 'text-amber-400' }
  return { label: `${days}d ${remHrs}h in queue`, cls: 'text-red-400' }
}

export default function DepartmentBoard({ slug, dept }: { slug: string; dept: string }) {
  const board = Object.values(CREW_BOARDS).find(b => b.urlParam === dept) ?? null

  const [jobs, setJobs] = useState<DisplayJob[]>([])
  const [stats, setStats] = useState<DisplayStats>(EMPTY_STATS)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!board) return
    let dataInterval: ReturnType<typeof setInterval> | undefined
    let clockInterval: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    const doFetch = async (orgId: string) => {
      try {
        const [newJobs, newStats] = await Promise.all([
          getDisplayJobs(orgId, [...board.codes]),
          getDisplayStats(orgId, [...board.codes]),
        ])
        if (cancelled) return
        setJobs(newJobs)
        if (newStats) setStats(newStats)
        setLastUpdated(new Date())
        setFetchFailed(false)
      } catch {
        if (!cancelled) setFetchFailed(true)
      }
    }

    const init = async () => {
      const orgId = await getOrgId(slug)
      if (cancelled) return
      if (!orgId) { setFetchFailed(true); return }
      await doFetch(orgId)
      if (cancelled) return
      dataInterval = setInterval(() => doFetch(orgId), 30000)
      clockInterval = setInterval(() => { if (!cancelled) setNow(new Date()) }, 1000)
    }

    init()
    return () => {
      cancelled = true
      clearInterval(dataInterval)
      clearInterval(clockInterval)
    }
  }, [slug, dept]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!board) {
    return (
      <div className="fixed inset-0 z-[100] bg-[#1A1A1A] flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">⚠</div>
          <div className="text-2xl font-bold text-white">Unknown department: {dept}</div>
          <div className="text-gray-500 mt-2">Valid params: design, large_format, commercial, installation, digital</div>
        </div>
      </div>
    )
  }

  const today = todayStr()
  const tomorrow = tomorrowStr()
  const sorted = sortJobs(jobs, today, tomorrow)

  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const secondsSinceUpdate = lastUpdated ? Math.floor((now.getTime() - lastUpdated.getTime()) / 1000) : 0

  const { total_jobs, completed_today, not_started, in_progress, due_today, overdue, avg_completion_hours, oldest_active_job_hours } = stats
  const pct = Math.min(100, (completed_today / Math.max(total_jobs, 1)) * 100)

  const currentHour = now.getHours()
  const currentMinute = now.getMinutes()
  const minutesSinceStart = Math.max(0, (currentHour - 8) * 60 + currentMinute)

  let paceMsg = ''
  let paceCls = 'text-gray-600 text-sm'
  if (completed_today > 0 && minutesSinceStart > 0) {
    const avgMins = minutesSinceStart / completed_today
    const minsNeeded = (total_jobs - completed_today) * avgMins
    const projected = new Date(now.getTime() + minsNeeded * 60000)
    const shiftEnd = new Date(now); shiftEnd.setHours(17, 30, 0, 0)
    const projStr = projected.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    if (projected <= shiftEnd) {
      paceMsg = `🟢 On pace — done by ${projStr}`; paceCls = 'text-green-400 font-bold text-base'
    } else if (projected.getTime() <= shiftEnd.getTime() + 3600000) {
      paceMsg = `🟡 Close — done by ${projStr}`; paceCls = 'text-amber-400 font-bold text-base'
    } else {
      paceMsg = `🔴 Behind — done by ${projStr}`; paceCls = 'text-red-400 font-bold text-base'
    }
  } else if (currentHour >= 8) {
    paceMsg = '— Complete first job to see pace'; paceCls = 'text-gray-600 text-sm'
  }

  let statusMsg = ''
  let statusCls = ''
  if (overdue > 0) {
    statusMsg = `⚠ ${overdue} OVERDUE — needs attention`; statusCls = 'text-red-400 font-bold text-sm'
  } else if (due_today > 0) {
    statusMsg = `📅 ${due_today} due today — stay on track`; statusCls = 'text-amber-400 text-sm'
  } else if (completed_today > 0 && total_jobs === 0) {
    statusMsg = '🏆 All jobs complete!'; statusCls = 'text-[#93ca3b] font-bold text-sm'
  } else {
    statusMsg = '✅ No overdue jobs'; statusCls = 'text-[#93ca3b] text-sm'
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#1A1A1A] flex flex-col overflow-hidden">

      {/* ① HEADER */}
      <div className="bg-[#93ca3b] h-16 flex items-center justify-between px-8 shrink-0">
        <span className="text-3xl font-black text-white tracking-widest">{board.label}</span>
        <span className="text-lg text-white opacity-80">Quarter Mile Inc.</span>
        <div className="text-right">
          <div className="text-2xl font-black text-white">{timeStr}</div>
          <div className="text-xs text-white opacity-70">{dateStr}</div>
        </div>
      </div>

      {/* ② STATS BAR */}
      <div className="bg-[#111111] border-b border-gray-800 px-6 py-3 shrink-0">
        <div className="grid grid-cols-6 gap-3">
          {/* Total Jobs */}
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className="text-6xl font-black text-white leading-none">{total_jobs}</div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">TOTAL JOBS</div>
            <div className="text-xs text-gray-600">in queue</div>
          </div>
          {/* Not Started */}
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className={`text-6xl font-black leading-none ${not_started > 6 ? 'text-red-500' : not_started > 0 ? 'text-amber-500' : 'text-gray-500'}`}>
              {not_started}
            </div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">NOT STARTED</div>
            <div className="text-xs text-gray-600">waiting to begin</div>
          </div>
          {/* In Progress */}
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className={`text-6xl font-black leading-none ${in_progress > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
              {in_progress}
            </div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">IN PROGRESS</div>
            <div className="text-xs text-gray-600">being worked now</div>
          </div>
          {/* Due Today */}
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className={`text-6xl font-black leading-none ${due_today > 0 ? 'text-red-500' : 'text-gray-500'}`}>
              {due_today}
            </div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">DUE TODAY</div>
            <div className="text-xs text-gray-600">must ship today</div>
          </div>
          {/* Done Today */}
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className="text-6xl font-black text-[#93ca3b] leading-none">{completed_today}</div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">DONE TODAY</div>
            <div className="text-xs text-gray-600">
              {avg_completion_hours != null ? `avg ${avg_completion_hours}h per job` : 'avg — hrs'}
            </div>
          </div>
          {/* Overdue */}
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className={`text-6xl font-black leading-none ${overdue > 0 ? 'text-red-500 animate-pulse' : 'text-gray-500'}`}>
              {overdue}
            </div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">OVERDUE</div>
            <div className="text-xs text-gray-600">
              {oldest_active_job_hours != null && oldest_active_job_hours > 48
                ? `⚠ oldest: ${oldest_active_job_hours.toFixed(0)}h`
                : 'clear'}
            </div>
          </div>
        </div>
      </div>

      {/* ③ GAMIFICATION STRIP */}
      <div className="bg-[#0D0D0D] border-b border-gray-800 px-6 py-2 shrink-0">
        <div className="flex items-center gap-8">
          {/* Left — Daily Goal */}
          <div className="flex-1">
            <div className="text-xs text-gray-600 uppercase tracking-widest mb-1">TODAY'S GOAL</div>
            <div className="w-full h-2 bg-gray-800 rounded-full">
              <div
                className={`h-2 rounded-full transition-all duration-1000 ${pct < 34 ? 'bg-red-500' : pct < 67 ? 'bg-amber-500' : 'bg-[#93ca3b]'}`}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            <div className="text-sm text-white mt-1">{completed_today} of {total_jobs} complete — {pct.toFixed(0)}%</div>
          </div>
          {/* Center — Pace */}
          <div className="flex-1 text-center">
            {paceMsg && <span className={paceCls}>{paceMsg}</span>}
          </div>
          {/* Right — Status */}
          <div className="flex-1 text-right">
            {statusMsg && <span className={statusCls}>{statusMsg}</span>}
          </div>
        </div>
      </div>

      {/* ④ JOB CARDS */}
      <div className="flex-1 overflow-y-auto p-4">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-6xl mb-4">✅</div>
              <div className="text-2xl font-bold text-white">Queue is clear!</div>
              <div className="text-gray-600 mt-2">No active jobs in {board.label}</div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 content-start">
            {sorted.map(job => {
              const isOverdue = !!(job.due_date && job.due_date < today)
              const isDueToday = job.due_date === today
              const isDueTomorrow = job.due_date === tomorrow
              const isRevision = !isOverdue && !isDueToday && job.proof_status === 'revision_requested'

              let borderCls = 'border-gray-700'
              if (isOverdue) borderCls = 'border-red-600'
              else if (isDueToday) borderCls = 'border-amber-500'
              else if (isRevision) borderCls = 'border-red-600 animate-pulse'
              else if (job.status === 'in_progress') borderCls = 'border-[#93ca3b]'
              else if (job.status === 'new') borderCls = 'border-gray-600'

              const daysOverdue = isOverdue
                ? Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(job.due_date! + 'T00:00:00').getTime()) / 86400000)
                : 0

              const qt = queueTime(job.created_at, now)
              const contactName = [job.customer?.first_name, job.customer?.last_name].filter(Boolean).join(' ')
              const deptLabel = job.department ? (DEPT_LABELS[job.department] ?? job.department) : null

              let pillCls = 'bg-gray-700 text-gray-300'
              let pillLabel = 'New'
              if (job.status === 'in_progress') { pillCls = 'bg-amber-900/50 text-amber-300'; pillLabel = 'In Progress' }
              else if (job.status === 'on_hold') { pillCls = 'bg-gray-600 text-gray-300'; pillLabel = 'On Hold' }

              return (
                <div key={job.id} className={`bg-[#2A2A2A] rounded-xl p-4 border-l-4 ${borderCls}`}>
                  {/* Row 1 */}
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-[#93ca3b]">JOB #{job.job_number}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${pillCls}`}>{pillLabel}</span>
                  </div>
                  {/* Row 2 — Company */}
                  <div className="text-lg font-bold text-white leading-tight mt-1">
                    {job.customer?.company_name || 'No Customer'}
                  </div>
                  {/* Row 3 — Contact */}
                  {contactName && <div className="text-sm text-gray-400 mt-0.5">{contactName}</div>}
                  {/* Row 4 — Dept badge */}
                  {deptLabel && (
                    <div className="mt-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">{deptLabel}</span>
                    </div>
                  )}
                  {/* Row 5 — Description */}
                  <div className="text-sm text-gray-300 mt-1 line-clamp-2">
                    {job.description || 'No description'}
                  </div>
                  {/* Row 6 — Due + queue */}
                  <div className="flex justify-between items-end mt-3">
                    <div>
                      {isOverdue ? (
                        <span className="text-red-400 text-sm font-bold">⚠ OVERDUE {daysOverdue}d</span>
                      ) : isDueToday ? (
                        <span className="text-amber-400 text-sm font-bold">📅 DUE TODAY</span>
                      ) : isDueTomorrow ? (
                        <span className="text-yellow-400 text-sm">Due Tomorrow</span>
                      ) : job.due_date ? (
                        <span className="text-gray-400 text-sm">
                          Due {new Date(job.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-sm">No due date</span>
                      )}
                    </div>
                    <span className={`text-xs ${qt.cls}`}>{qt.label}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ⑤ FOOTER */}
      <div className="h-7 bg-black flex items-center justify-between px-6 shrink-0">
        <span className="text-xs text-gray-700">PrintOS Production Display</span>
        <span className="text-xs text-gray-600">Auto-refreshes every 30s · Last updated: {secondsSinceUpdate}s ago</span>
        {fetchFailed ? (
          <span className="text-amber-400 text-xs">⚠ Reconnecting...</span>
        ) : (
          <span className="text-xs text-gray-800">{[...board.codes].join(' + ')}</span>
        )}
      </div>
    </div>
  )
}
