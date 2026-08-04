import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { resolveDateRange, type DateRangePreset } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string }>
}

type QuoteRow = {
  sales_rep_id: string | null
  status: string
  total: number | null
}

type RepStat = {
  repId: string
  name: string
  totalQuotes: number
  totalValue: number
  wonCount: number
  wonValue: number
}

const WON_STATUSES = new Set(['ordered', 'approved', 'internally_approved'])

export default async function SalesByRepReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[reports-sales-by-rep] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (reports-sales-by-rep)</h1>
        <div><strong>Message:</strong> {message}</div>
        {stack && <pre style={{ fontSize: '0.75rem', overflowX: 'auto', marginTop: '1rem' }}>{stack}</pre>}
      </div>
    )
  }
}

async function PageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name').eq('slug', slug).maybeSingle()
  ) as { id: string; name: string } | null
  if (!org) notFound()

  const { allowed: canRunReport } = await checkPermission(org.id, 'reports.quotes')
  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')
  if (!canRunReport) notFound()

  const range = resolveDateRange(sp.preset as DateRangePreset | undefined, sp.start, sp.end)

  // Fetch team members for name resolution via service client (bypasses RLS).
  type RawMemberRow = { user_id: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)
    .in('role', ['owner', 'admin', 'member']) as { data: RawMemberRow[] | null; error: unknown }

  const memberUserIds = (memberRows ?? []).map(m => m.user_id)
  const service = createServiceClient()
  const nameById = new Map<string, string>()

  if (memberUserIds.length > 0) {
    type ProfileRow = { id: string; full_name: string | null }
    const { data: profileRows } = await service
      .from('profiles')
      .select('id, full_name')
      .in('id', memberUserIds) as { data: ProfileRow[] | null; error: unknown }
    for (const p of profileRows ?? []) {
      nameById.set(p.id, p.full_name ?? p.id)
    }
    const missing = memberUserIds.filter(id => !nameById.has(id))
    if (missing.length > 0) {
      const { data: { users: authUsers } } = await service.auth.admin.listUsers()
      for (const u of authUsers ?? []) {
        if (!nameById.has(u.id) && u.email) nameById.set(u.id, u.email)
      }
    }
  }

  // Fetch all quotes in range (aggregate in JS — reps count is small)
  const { data: quotes } = await supabase
    .from('quotes')
    .select('sales_rep_id, status, total')
    .eq('organization_id', org.id)
    .gte('created_at', range.start)
    .lte('created_at', range.end)
    .limit(2000) as { data: QuoteRow[] | null; error: unknown }

  const repMap = new Map<string, RepStat>()

  for (const q of quotes ?? []) {
    const repId = q.sales_rep_id ?? '__unassigned__'
    if (!repMap.has(repId)) {
      repMap.set(repId, {
        repId,
        name: repId === '__unassigned__' ? 'Unassigned' : (nameById.get(repId) ?? repId),
        totalQuotes: 0,
        totalValue: 0,
        wonCount: 0,
        wonValue: 0,
      })
    }
    const stat = repMap.get(repId)!
    stat.totalQuotes++
    stat.totalValue += q.total ?? 0
    if (WON_STATUSES.has(q.status)) {
      stat.wonCount++
      stat.wonValue += q.total ?? 0
    }
  }

  const rows = [...repMap.values()].sort((a, b) => b.totalValue - a.totalValue)

  return (
    <ReportShell
      orgSlug={slug}
      title="Sales by Rep"
      totalRows={rows.length}
      page={1}
      pageCount={1}
      exportHref={`/api/reports/sales-by-rep?org=${org.id}`}
    >
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Sales Rep</th>
                <th className="px-3 py-2 text-right">Quotes</th>
                {canSeePricing && <th className="px-3 py-2 text-right">Total Quoted</th>}
                <th className="px-3 py-2 text-right">Won</th>
                {canSeePricing && <th className="px-3 py-2 text-right">Won Value</th>}
                <th className="px-3 py-2 text-right">Win Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {rows.map((r) => {
                const winRate = r.totalQuotes > 0 ? Math.round((r.wonCount / r.totalQuotes) * 100) : 0
                return (
                  <tr key={r.repId} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-[#1A1A1A]">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.totalQuotes}</td>
                    {canSeePricing && (
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        ${(r.totalValue / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.wonCount}</td>
                    {canSeePricing && (
                      <td className="px-3 py-2 text-right tabular-nums text-green-700 font-medium">
                        ${(r.wonValue / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right">
                      <span className={`text-xs font-medium ${winRate >= 50 ? 'text-green-700' : winRate >= 25 ? 'text-yellow-700' : 'text-gray-500'}`}>
                        {winRate}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          No quotes in this date range.
        </div>
      )}
    </ReportShell>
  )
}
