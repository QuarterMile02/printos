import Link from 'next/link'
import WidgetCard from './widget-card'
import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>
type Props = { service: ServiceClient; orgId: string; orgSlug: string }

type MatRow = {
  id: string
  name: string
  current_stock: number | null
  min_stock_level: number | null
  reorder_quantity: number | null
  preferred_vendor: string | null
}

export default async function LowStockWidget({ service, orgId, orgSlug }: Props) {
  try {
    // Supabase JS can't express col-vs-col comparisons (current_stock < min_stock_level),
    // so we fetch all materials with a min_stock_level set and filter in JS.
    // The partial index on the DB makes the underlying query efficient.
    const { data, error } = await service
      .from('materials')
      .select('id, name, current_stock, min_stock_level, reorder_quantity, preferred_vendor')
      .eq('organization_id', orgId)
      .eq('active', true)
      .gt('min_stock_level', 0) as { data: MatRow[] | null; error: unknown }

    if (error) throw error

    const rows = (data ?? [])
      .filter(r => Number(r.current_stock ?? 0) < Number(r.min_stock_level ?? 0))
      .sort((a, b) => {
        // Most critical first: lowest (current / min) ratio = closest to empty
        const rA = Number(a.current_stock ?? 0) / Number(a.min_stock_level ?? 1)
        const rB = Number(b.current_stock ?? 0) / Number(b.min_stock_level ?? 1)
        return rA - rB
      })

    return (
      <WidgetCard title="Low Stock Materials" span={12}>
        {rows.length === 0 ? (
          <p className="text-sm font-medium text-green-600">✓ All materials are above minimum levels</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-gray-100">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Material</th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">In Stock</th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Min Level</th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-400">Reorder Qty</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-400">Vendor</th>
                    <th className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((r) => {
                    const cur = Number(r.current_stock ?? 0)
                    const min = Number(r.min_stock_level ?? 0)
                    const isOut = cur <= 0
                    return (
                      <tr key={r.id} className={`hover:bg-gray-50 ${isOut ? 'bg-red-50/40' : 'bg-amber-50/30'}`}>
                        <td className="px-4 py-2.5 font-medium text-[#1A1A1A]">
                          <Link href={`/dashboard/${orgSlug}/settings/materials/${r.id}`} className="hover:text-[#93ca3b]">
                            {r.name}
                          </Link>
                        </td>
                        <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${isOut ? 'text-red-600' : 'text-amber-600'}`}>
                          {cur.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">
                          {min.toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                          {Number(r.reorder_quantity ?? 0) > 0
                            ? Number(r.reorder_quantity).toFixed(2)
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="max-w-[140px] truncate px-4 py-2.5 text-gray-600">
                          {r.preferred_vendor ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                            isOut ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {isOut ? 'Out' : 'Low'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-right">
              <Link
                href={`/dashboard/${orgSlug}/settings/materials?low_stock=1`}
                className="text-xs text-[#93ca3b] hover:underline"
              >
                View all in materials list →
              </Link>
            </div>
          </>
        )}
      </WidgetCard>
    )
  } catch {
    return (
      <WidgetCard title="Low Stock Materials" span={12}>
        <p className="text-sm text-gray-400">Unable to load</p>
      </WidgetCard>
    )
  }
}
