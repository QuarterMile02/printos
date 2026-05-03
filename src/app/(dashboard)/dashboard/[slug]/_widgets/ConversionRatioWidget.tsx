import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string }

function monthBounds(y: number, m: number) {
  const start = new Date(y, m, 1).toISOString()
  const end   = new Date(y, m + 1, 0, 23, 59, 59, 999).toISOString()
  return { start, end }
}

function pct(converted: number, total: number) {
  if (total === 0) return 0
  return Math.round((converted / total) * 100)
}

export default async function ConversionRatioWidget({ service, orgId }: Props) {
  const now   = new Date()
  const cy    = now.getFullYear()
  const cm    = now.getMonth()
  const pmY   = cm === 0 ? cy - 1 : cy
  const pmM   = cm === 0 ? 11 : cm - 1

  const thisBounds = monthBounds(cy, cm)
  const prevBounds = monthBounds(pmY, pmM)

  try {
    // Fetch counts in parallel: this month + prev month, both total and converted
    const [thisAll, thisConv, prevAll, prevConv] = await Promise.all([
      service.from('quotes').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('created_at', thisBounds.start).lte('created_at', thisBounds.end)
        .then(r => r.count ?? 0),
      service.from('quotes').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('created_at', thisBounds.start).lte('created_at', thisBounds.end)
        .not('converted_to_so_id', 'is', null)
        .then(r => r.count ?? 0),
      service.from('quotes').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('created_at', prevBounds.start).lte('created_at', prevBounds.end)
        .then(r => r.count ?? 0),
      service.from('quotes').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .gte('created_at', prevBounds.start).lte('created_at', prevBounds.end)
        .not('converted_to_so_id', 'is', null)
        .then(r => r.count ?? 0),
    ])

    const thisRate = pct(thisConv, thisAll)
    const prevRate = pct(prevConv, prevAll)
    const delta    = thisRate - prevRate
    const up       = delta >= 0

    const monthLabel = now.toLocaleString('en-US', { month: 'short' })
    const prevLabel  = new Date(pmY, pmM).toLocaleString('en-US', { month: 'short' })

    return (
      <WidgetCard title="Conversion Ratio" span={6}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-end gap-1">
              <span className="text-5xl font-extrabold text-[#1A1A1A]">{thisRate}%</span>
              <span className="mb-1.5 text-sm text-gray-400">{monthLabel}</span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {thisConv} of {thisAll} quotes converted to orders
            </p>
          </div>
          <div className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${
            delta === 0 ? 'bg-gray-100 text-gray-500'
              : up ? 'bg-green-50 text-green-700'
                   : 'bg-red-50 text-red-600'
          }`}>
            {delta !== 0 && (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d={up ? 'M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25' : 'M19.5 4.5l-15 15m0 0h11.25m-11.25 0V8.25'} />
              </svg>
            )}
            {delta > 0 ? `+${delta}` : delta}pp vs {prevLabel}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide">{prevLabel}</p>
            <p className="mt-1 text-2xl font-bold text-gray-700">{prevRate}%</p>
            <p className="text-xs text-gray-400">{prevConv} / {prevAll}</p>
          </div>
          <div className="rounded-lg bg-qm-lime-light p-3">
            <p className="text-xs text-qm-lime-dark uppercase tracking-wide">{monthLabel}</p>
            <p className="mt-1 text-2xl font-bold text-qm-lime-dark">{thisRate}%</p>
            <p className="text-xs text-qm-lime-dark/70">{thisConv} / {thisAll}</p>
          </div>
        </div>
      </WidgetCard>
    )
  } catch {
    return (
      <WidgetCard title="Conversion Ratio" span={6}>
        <p className="text-sm text-gray-400">Unable to load</p>
      </WidgetCard>
    )
  }
}
