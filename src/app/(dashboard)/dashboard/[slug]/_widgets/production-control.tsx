// Production Control — three click-through count cards for Past Due,
// Change Requested, and New Today. Click jumps to the jobs page filtered
// where possible (current /jobs route only supports flag filters; deep
// filtering will improve when the jobs page gets URL params).

import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
}

export default async function ProductionControl({ service, orgId, orgSlug }: Props) {
  const todayDate = new Date().toISOString().slice(0, 10)
  const todayIso = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString() })()

  const [pastDue, changeRequested, newToday] = await Promise.all([
    service.from('jobs').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).neq('status', 'completed').lt('due_date', todayDate)
      .then((r) => r.count ?? 0),
    service.from('jobs').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('needs_revision', true)
      .then((r) => r.count ?? 0),
    service.from('jobs').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).gte('created_at', todayIso)
      .then((r) => r.count ?? 0),
  ])

  const cards = [
    { label: 'Past Due',         count: pastDue,         tone: 'red',   href: `/dashboard/${orgSlug}/jobs` },
    { label: 'Change Requested', count: changeRequested, tone: 'amber', href: `/dashboard/${orgSlug}/jobs` },
    { label: 'New Today',        count: newToday,        tone: 'green', href: `/dashboard/${orgSlug}/jobs` },
  ] as const

  const tones = {
    red:   'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    green: 'border-green-200 bg-green-50 text-green-700',
  }

  return (
    <WidgetCard title="Production Control" span={6}>
      <div className="grid grid-cols-3 gap-2">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className={`rounded-lg border p-3 text-center transition hover:brightness-110 ${tones[c.tone]}`}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider">{c.label}</p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums">{c.count.toLocaleString()}</p>
          </Link>
        ))}
      </div>
    </WidgetCard>
  )
}
