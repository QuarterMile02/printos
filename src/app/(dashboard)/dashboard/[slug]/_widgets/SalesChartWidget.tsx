'use client'

import { useState, useEffect } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { createClient } from '@/lib/supabase/client'
import WidgetCard from './widget-card'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

type MonthRow = {
  month: number
  goals: number
  orders: number
  actuals: number
  prevYear: number
}

function buildEmpty(): MonthRow[] {
  return MONTHS.map((_, i) => ({ month: i + 1, goals: 0, orders: 0, actuals: 0, prevYear: 0 }))
}

function dollars(cents: number) {
  if (cents >= 1_000_000) return `$${(cents / 100_000_000).toFixed(1)}M`
  if (cents >= 1_000)     return `$${(cents / 100_000).toFixed(0)}K`
  return `$${(cents / 100).toFixed(0)}`
}

type Props = { orgId: string }

export default function SalesChartWidget({ orgId }: Props) {
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [data, setData] = useState<MonthRow[]>(buildEmpty())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const sb = createClient()
        const start  = `${year}-01-01`
        const end    = `${year}-12-31`
        const pStart = `${year - 1}-01-01`
        const pEnd   = `${year - 1}-12-31`

        type SoRow = { created_at: string; total: number | null; status: string }

        const [curRes, prevRes] = await Promise.all([
          sb.from('sales_orders')
            .select('created_at, total, status')
            .eq('organization_id', orgId)
            .gte('created_at', start)
            .lte('created_at', end) as unknown as Promise<{ data: SoRow[] | null; error: unknown }>,
          sb.from('sales_orders')
            .select('created_at, total, status')
            .eq('organization_id', orgId)
            .gte('created_at', pStart)
            .lte('created_at', pEnd) as unknown as Promise<{ data: SoRow[] | null; error: unknown }>,
        ])

        if (cancelled) return
        if (curRes.error || prevRes.error) { setError(true); setLoading(false); return }

        const rows = buildEmpty()

        for (const row of curRes.data ?? []) {
          const m = new Date(row.created_at).getMonth() // 0-based
          rows[m].orders += 1
          if (row.status !== 'void') rows[m].actuals += (row.total ?? 0)
        }
        for (const row of prevRes.data ?? []) {
          const m = new Date(row.created_at).getMonth()
          if (row.status !== 'void') rows[m].prevYear += (row.total ?? 0)
        }

        setData(rows)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [orgId, year])

  const yearNav = (
    <div className="flex items-center gap-1.5">
      <button onClick={() => setYear(y => y - 1)} className="rounded p-1 hover:bg-gray-100 text-gray-500">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
      </button>
      <span className="w-12 text-center text-sm font-semibold text-gray-700">{year}</span>
      <button onClick={() => setYear(y => y + 1)} disabled={year >= currentYear} className="rounded p-1 hover:bg-gray-100 text-gray-500 disabled:opacity-30">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
      </button>
    </div>
  )

  return (
    <WidgetCard title="Sales Chart" span={12} action={yearNav}>
      {loading ? (
        <div className="h-64 animate-pulse rounded-lg bg-gray-100" />
      ) : error ? (
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">Unable to load</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data.map(r => ({ ...r, name: MONTHS[r.month - 1] }))} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={v => dollars(v)} tick={{ fontSize: 11 }} width={56} />
            <Tooltip
              formatter={(value, name) => {
                const v = value as number | undefined
                if (v === undefined) return ['—', name]
                return name === 'Orders'
                  ? [v, name]
                  : [`$${(v / 100).toLocaleString('en-US', { minimumFractionDigits: 0 })}`, name]
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar    dataKey="goals"   name="Goals"     fill="#d1d5db" barSize={16} />
            <Line  dataKey="orders"  name="Orders"    stroke="#3b82f6" strokeWidth={2} dot={false} yAxisId={0} />
            <Line  dataKey="actuals" name="Actuals"   stroke="#93ca3b" strokeWidth={2} dot={false} />
            <Line  dataKey="prevYear" name="Prev Year" stroke="#989899" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </WidgetCard>
  )
}
