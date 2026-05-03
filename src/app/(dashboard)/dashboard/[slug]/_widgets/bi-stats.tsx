// Business Intelligence — three stat cards (Quotes / Sales Orders /
// Invoices) for the selected date range. Toggles between count and
// total $ value. Date preset is encoded in URL searchParams so the
// dashboard page server-fetches the right window.

import Link from 'next/link'
import WidgetCard from './widget-card'
import { resolveDateRange, type DateRangePreset } from '@/lib/reports/report-utils'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

type Props = {
  service: ServiceClient
  orgId: string
  orgSlug: string
  preset: DateRangePreset
  mode: 'count' | 'value'
}

const PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: 'this_week', label: 'This Week' },
  { value: 'this_month', label: 'This Month' }, { value: 'last_30', label: 'Last 30' },
  { value: 'ytd', label: 'YTD' },
]

function formatCents(c: number): string { return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

export default async function BiStats({ service, orgId, orgSlug, preset, mode }: Props) {
  const range = resolveDateRange(preset, undefined, undefined)

  // Run the three count + total queries in parallel. We always pull
  // counts; for value mode we additionally sum the cents columns.
  const [quotesAgg, soAgg, invAgg] = await Promise.all([
    Promise.all([
      service.from('quotes').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).gte('created_at', range.start).lte('created_at', range.end)
        .then((r) => r.count ?? 0),
      service.from('quotes').select('total')
        .eq('organization_id', orgId).gte('created_at', range.start).lte('created_at', range.end)
        .then((r) => (r.data ?? []).reduce<number>((s, row) => s + Number((row as { total: number | null }).total ?? 0), 0)),
    ]),
    Promise.all([
      service.from('sales_orders').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).gte('created_at', range.start).lte('created_at', range.end)
        .then((r) => r.count ?? 0),
      service.from('sales_orders').select('total')
        .eq('organization_id', orgId).gte('created_at', range.start).lte('created_at', range.end)
        .then((r) => (r.data ?? []).reduce<number>((s, row) => s + Number((row as { total: number | null }).total ?? 0), 0)),
    ]),
    Promise.all([
      service.from('invoices').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).gte('created_at', range.start).lte('created_at', range.end)
        .then((r) => r.count ?? 0),
      service.from('invoices').select('total')
        .eq('organization_id', orgId).gte('created_at', range.start).lte('created_at', range.end)
        .then((r) => (r.data ?? []).reduce<number>((s, row) => s + Number((row as { total: number | null }).total ?? 0), 0)),
    ]),
  ])

  const cards: { label: string; count: number; value: number; href: string }[] = [
    { label: 'Quotes',        count: quotesAgg[0], value: quotesAgg[1], href: `/dashboard/${orgSlug}/quotes` },
    { label: 'Sales Orders',  count: soAgg[0],     value: soAgg[1],     href: `/dashboard/${orgSlug}/sales-orders` },
    { label: 'Invoices',      count: invAgg[0],    value: invAgg[1],    href: `/dashboard/${orgSlug}/invoices` },
  ]

  // The selectors are GET <a>s — server-render preserves SSR while
  // letting the dashboard page re-fetch on toggle. Avoids client JS for
  // a control that's used once per session.
  const buildHref = (overrides: Partial<{ bi_preset: DateRangePreset; bi_mode: 'count' | 'value' }>) => {
    const params = new URLSearchParams()
    params.set('bi_preset', overrides.bi_preset ?? preset)
    params.set('bi_mode', overrides.bi_mode ?? mode)
    return `?${params.toString()}`
  }

  const action = (
    <div className="flex items-center gap-1.5">
      {PRESETS.map((p) => (
        <Link
          key={p.value}
          href={buildHref({ bi_preset: p.value })}
          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
            preset === p.value ? 'bg-[#1A1A1A] text-white' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {p.label}
        </Link>
      ))}
      <span className="mx-1 h-4 w-px bg-gray-200" />
      <Link
        href={buildHref({ bi_mode: 'count' })}
        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${mode === 'count' ? 'bg-[#93ca3b] text-white' : 'text-gray-500 hover:text-gray-700'}`}
      >Count</Link>
      <Link
        href={buildHref({ bi_mode: 'value' })}
        className={`rounded px-2 py-0.5 text-[11px] font-semibold ${mode === 'value' ? 'bg-[#93ca3b] text-white' : 'text-gray-500 hover:text-gray-700'}`}
      >$ Value</Link>
    </div>
  )

  return (
    <WidgetCard title="Business Intelligence" action={action}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-lg border border-gray-200 p-4 transition hover:border-[#93ca3b] hover:shadow-sm"
          >
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500">{c.label}</p>
            <p className="mt-2 text-3xl font-extrabold tabular-nums text-[#1A1A1A]">
              {mode === 'count' ? c.count.toLocaleString() : formatCents(c.value)}
            </p>
            <p className="mt-1 text-[11px] text-gray-400">
              {mode === 'count' ? `${formatCents(c.value)} value` : `${c.count.toLocaleString()} records`}
            </p>
          </Link>
        ))}
      </div>
    </WidgetCard>
  )
}
