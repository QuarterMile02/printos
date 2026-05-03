'use client'

import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import WidgetCard from './widget-card'

// Maps assigned_printer values → display department names.
// Extend as QMI adds printers/departments.
const PRINTER_TO_DEPT: Record<string, string> = {
  'large_format': 'Large Format',
  'commercial':   'Commercial Print',
  'installation': 'Installation',
  'design':       'Design',
  'digital':      'Digital',
  'fabrication':  'Fabrication',
}

type DeptCount = { name: string; count: number; key: string }

type Props = { orgId: string; orgSlug: string }

export default function DepartmentQueueWidget({ orgId, orgSlug }: Props) {
  const router = useRouter()
  const [data, setData]     = useState<DeptCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(false)
      try {
        const sb = createClient()
        type JobQRow = { assigned_printer: string | null; status: string }
        const { data: rows, error: err } = await sb
          .from('jobs')
          .select('assigned_printer, status')
          .eq('organization_id', orgId)
          .in('status', ['new', 'in_progress']) as { data: JobQRow[] | null; error: unknown }

        if (cancelled) return
        if (err) { setError(true); setLoading(false); return }

        // Group by assigned_printer (or 'unassigned')
        const counts = new Map<string, number>()
        for (const r of rows ?? []) {
          const key = r.assigned_printer?.trim().toLowerCase() ?? 'unassigned'
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }

        const result: DeptCount[] = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => ({
            key,
            name: PRINTER_TO_DEPT[key] ?? (key.charAt(0).toUpperCase() + key.slice(1)),
            count,
          }))

        setData(result)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [orgId])

  const BAR_COLORS = ['#93ca3b','#3b82f6','#f59e0b','#8b5cf6','#ef4444','#14b8a6']

  return (
    <WidgetCard title="Department Queue" span={6}>
      {loading ? (
        <div className="h-48 animate-pulse rounded-lg bg-gray-100" />
      ) : error ? (
        <p className="text-sm text-gray-400">Unable to load</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-gray-400">No active jobs</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 40)}>
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
            onClick={(e) => {
              const payload = (e as { activePayload?: { payload: DeptCount }[] })?.activePayload
              if (payload?.[0]) {
                router.push(`/dashboard/${orgSlug}/jobs?department=${encodeURIComponent(payload[0].payload.key)}`)
              }
            }}
          >
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(v) => {
                const n = v as number | undefined
                if (n === undefined) return ['—', 'Active']
                return [`${n} job${n !== 1 ? 's' : ''}`, 'Active']
              }}
              cursor={{ fill: 'rgba(0,0,0,0.04)' }}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }}>
              {data.map((_, i) => (
                <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </WidgetCard>
  )
}
