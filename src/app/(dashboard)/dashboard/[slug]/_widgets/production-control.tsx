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
      {newToday > 0 && (
        <div className="mt-3 text-center">
          <a
            href={`/api/jobs/labels?org=${orgId}&since=${todayDate}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition"
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.054 48.054 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
            </svg>
            Print today&apos;s {newToday} label{newToday !== 1 ? 's' : ''}
          </a>
        </div>
      )}
    </WidgetCard>
  )
}
