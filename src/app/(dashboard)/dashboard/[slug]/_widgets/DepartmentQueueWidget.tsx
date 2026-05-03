'use client'

import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import WidgetCard from './widget-card'

// Display labels for all 9 standard department codes + legacy assigned_printer fallbacks.
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
  // Legacy assigned_printer values kept as fallback
  commercial:        'Commercial Print',
  design:            'Design',
  digital:           'Digital Marketing',
}

type DeptCount = { name: string; count: number; key: string }
type Props = { orgId: string; orgSlug: string }

export default function DepartmentQueueWidget({ orgId, orgSlug }: Props) {
  const router = useRouter()
  const [data, setData]       = useState<DeptCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(false)
      try {
        const sb = createClient()
        type JobQRow = { department: string | null; assigned_printer: string | null; status: string }
        const { data: rows, error: err } = await sb
          .from('jobs')
          .select('department, assigned_printer, status')
          .eq('organization_id', orgId)
          .in('status', ['new', 'in_progress']) as { data: JobQRow[] | null; error: unknown }

        if (cancelled) return
        if (err) { setError(true); setLoading(false); return }

        // Prefer jobs.department; fall back to assigned_printer for legacy rows
        const counts = new Map<string, number>()
        for (const r of rows ?? []) {
          const raw = r.department ?? r.assigned_printer?.trim().toLowerCase()
          const key = raw ?? 'unassigned'
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }

        const result: DeptCount[] = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([key, count]) => ({
            key,
            name: DEPT_LABELS[key] ?? (key.charAt(0).toUpperCase() + key.slice(1)),
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
            <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
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
