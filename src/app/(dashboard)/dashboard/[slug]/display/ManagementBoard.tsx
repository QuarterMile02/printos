'use client'

import { useState, useEffect } from 'react'
import { getOrgId, getDisplayStats, getDepartmentSummaries, CREW_BOARDS, MANAGEMENT_UNITS } from './actions'
import type { DisplayStats, CrewBoardSummary, ManagementUnitSummary } from './actions'

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

const ALL_CODES = [
  ...Object.values(CREW_BOARDS).flatMap(b => b.codes),
  ...MANAGEMENT_UNITS.flatMap(u => u.codes),
].filter((v, i, a) => a.indexOf(v) === i)

export default function ManagementBoard({ slug }: { slug: string }) {
  const [stats, setStats] = useState<DisplayStats>(EMPTY_STATS)
  const [crewBoards, setCrewBoards] = useState<CrewBoardSummary[]>([])
  const [units, setUnits] = useState<ManagementUnitSummary[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let dataInterval: ReturnType<typeof setInterval> | undefined
    let clockInterval: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    const doFetch = async (orgId: string) => {
      try {
        const [newStats, summaries] = await Promise.all([
          getDisplayStats(orgId, ALL_CODES),
          getDepartmentSummaries(orgId),
        ])
        if (cancelled) return
        if (newStats) setStats(newStats)
        setCrewBoards(summaries.crewBoards)
        setUnits(summaries.managementUnits)
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
  }, [slug])

  const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const secondsSinceUpdate = lastUpdated ? Math.floor((now.getTime() - lastUpdated.getTime()) / 1000) : 0

  const { total_jobs, completed_today, not_started, in_progress, due_today, overdue, avg_completion_hours } = stats
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
    statusMsg = `📅 ${due_today} due today`; statusCls = 'text-amber-400 text-sm'
  } else {
    statusMsg = '✅ No overdue jobs'; statusCls = 'text-[#93ca3b] text-sm'
  }

  return (
    <div className="fixed inset-0 z-[100] bg-[#1A1A1A] flex flex-col overflow-hidden">

      {/* ① HEADER */}
      <div className="h-16 bg-[#1A1A1A] border-b-2 border-[#93ca3b] flex items-center justify-between px-8 shrink-0">
        <span className="text-2xl font-black text-[#93ca3b] tracking-widest">PRODUCTION OVERVIEW</span>
        <span className="text-lg text-gray-400">Quarter Mile Inc.</span>
        <div className="text-right">
          <div className="text-2xl font-black text-white">{timeStr}</div>
          <div className="text-xs text-gray-500">{dateStr}</div>
        </div>
      </div>

      {/* ② OVERALL STATS BAR */}
      <div className="bg-[#111111] border-b border-gray-800 px-6 py-3 shrink-0">
        <div className="grid grid-cols-6 gap-3">
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className="text-6xl font-black text-white leading-none">{total_jobs}</div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">TOTAL JOBS</div>
            <div className="text-xs text-gray-600">in queue</div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className={`text-6xl font-black leading-none ${not_started > 6 ? 'text-red-500' : not_started > 0 ? 'text-amber-500' : 'text-gray-500'}`}>
              {not_started}
            </div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">NOT STARTED</div>
            <div className="text-xs text-gray-600">waiting to begin</div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className={`text-6xl font-black leading-none ${in_progress > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
              {in_progress}
            </div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">IN PROGRESS</div>
            <div className="text-xs text-gray-600">being worked now</div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className={`text-6xl font-black leading-none ${due_today > 0 ? 'text-red-500' : 'text-gray-500'}`}>
              {due_today}
            </div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">DUE TODAY</div>
            <div className="text-xs text-gray-600">must ship today</div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className="text-6xl font-black text-[#93ca3b] leading-none">{completed_today}</div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">DONE TODAY</div>
            <div className="text-xs text-gray-600">
              {avg_completion_hours != null ? `avg ${avg_completion_hours}h per job` : 'avg — hrs'}
            </div>
          </div>
          <div className="bg-[#1E1E1E] rounded-lg p-3 flex flex-col items-center">
            <div className={`text-6xl font-black leading-none ${overdue > 0 ? 'text-red-500 animate-pulse' : 'text-gray-500'}`}>
              {overdue}
            </div>
            <div className="text-xs uppercase tracking-widest text-gray-500 mt-1">OVERDUE</div>
            <div className="text-xs text-gray-600">across all depts</div>
          </div>
        </div>

        {/* Gamification strip */}
        <div className="mt-3 flex items-center gap-8">
          <div className="flex-1">
            <div className="w-full h-2 bg-gray-800 rounded-full">
              <div
                className={`h-2 rounded-full transition-all duration-1000 ${pct < 34 ? 'bg-red-500' : pct < 67 ? 'bg-amber-500' : 'bg-[#93ca3b]'}`}
                style={{ width: `${pct.toFixed(1)}%` }}
              />
            </div>
            <div className="text-sm text-white mt-1">{completed_today} of {total_jobs} complete — {pct.toFixed(0)}%</div>
          </div>
          <div className="flex-1 text-center">
            {paceMsg && <span className={paceCls}>{paceMsg}</span>}
          </div>
          <div className="flex-1 text-right">
            {statusMsg && <span className={statusCls}>{statusMsg}</span>}
          </div>
        </div>
      </div>

      {/* ③ CREW BOARDS ROW */}
      <div className="bg-[#0D0D0D] border-b border-gray-800 px-6 py-3 shrink-0">
        <div className="text-xs text-gray-600 uppercase tracking-widest mb-2">CREW QUEUES</div>
        <div className="flex gap-3">
          {crewBoards.map(board => (
            <div
              key={board.urlParam}
              className="flex-1 bg-[#1A1A1A] rounded-lg p-3 cursor-pointer border border-gray-800 hover:border-[#93ca3b] transition-colors"
              onClick={() => window.open(`/dashboard/${slug}/display?dept=${board.urlParam}`, '_blank')}
            >
              <div className="text-sm font-bold text-white uppercase tracking-wide">{board.label}</div>
              <div className="text-2xl font-black text-white mt-1">{board.total_jobs}</div>
              <div className="flex gap-3 mt-1 text-xs">
                <span className="text-amber-400">🟡 {board.in_progress} active</span>
                <span className="text-gray-400">📅 {board.due_today} today</span>
                <span className={board.overdue > 0 ? 'text-red-400' : 'text-gray-600'}>🔴 {board.overdue} overdue</span>
              </div>
              <div className={`text-xs mt-1.5 ${board.overdue > 0 ? 'text-red-400' : 'text-[#93ca3b]'}`}>
                {board.overdue > 0 ? '⚠ Has overdue' : '✅ Clear'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ④ UNITS OF BUSINESS */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-xs text-gray-600 uppercase tracking-widest mb-3">UNITS OF BUSINESS</div>
        <div className="grid grid-cols-4 gap-4">
          {units.map(unit => {
            const doneRatio = unit.completed_today / Math.max(unit.completed_today + unit.total_jobs, 1)

            return (
              <div
                key={unit.label}
                className="bg-[#2A2A2A] rounded-xl p-4"
                style={{ borderTop: `3px solid ${unit.color}` }}
              >
                <div className="flex justify-between items-start">
                  <span className="text-base font-bold text-white uppercase tracking-wide leading-tight">{unit.label}</span>
                  <span className="bg-[#1A1A1A] text-white text-sm px-2 py-0.5 rounded-full shrink-0 ml-2">
                    {unit.total_jobs}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <div className="text-2xl font-black text-white">{unit.not_started}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Not Started</div>
                  </div>
                  <div>
                    <div className={`text-2xl font-black ${unit.in_progress > 0 ? 'text-amber-400' : 'text-white'}`}>
                      {unit.in_progress}
                    </div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">In Progress</div>
                  </div>
                  <div>
                    <div className={`text-2xl font-black ${unit.due_today > 0 ? 'text-red-500' : 'text-white'}`}>
                      {unit.due_today}
                    </div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Due Today</div>
                  </div>
                  <div>
                    <div className="text-2xl font-black text-[#93ca3b]">{unit.completed_today}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">Done Today</div>
                  </div>
                </div>

                <div className="mt-3 w-full h-1.5 bg-gray-800 rounded-full">
                  <div
                    className="h-1.5 rounded-full transition-all duration-1000"
                    style={{ width: `${(doneRatio * 100).toFixed(1)}%`, backgroundColor: unit.color }}
                  />
                </div>

                <div className="flex justify-between items-center mt-2">
                  <span className="text-xs text-gray-600">
                    {unit.oldest_active_hours != null
                      ? `Oldest: ${unit.oldest_active_hours.toFixed(0)}h`
                      : 'No active jobs'}
                  </span>
                  <span className={`text-xs font-semibold ${
                    unit.overdue > 0 ? 'text-red-400' : unit.due_today > 0 ? 'text-amber-400' : unit.total_jobs === 0 ? 'text-gray-600' : 'text-[#93ca3b]'
                  }`}>
                    {unit.overdue > 0
                      ? `⚠ ${unit.overdue} overdue`
                      : unit.due_today > 0
                      ? `📅 ${unit.due_today} today`
                      : unit.total_jobs === 0
                      ? '— Quiet'
                      : '✅ On track'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ⑤ FOOTER */}
      <div className="h-7 bg-black flex items-center justify-between px-6 shrink-0">
        <span className="text-xs text-gray-700">PrintOS Production Display</span>
        <span className="text-xs text-gray-600">Auto-refreshes every 30s · Last updated: {secondsSinceUpdate}s ago</span>
        {fetchFailed ? (
          <span className="text-amber-400 text-xs">⚠ Reconnecting...</span>
        ) : (
          <span />
        )}
      </div>
    </div>
  )
}
