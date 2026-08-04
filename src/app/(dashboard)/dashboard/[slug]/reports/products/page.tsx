import { notFound, unstable_rethrow } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'
import { resolveDateRange, paginate, type DateRangePreset } from '@/lib/reports/report-utils'
import ReportShell from '../report-shell'
import ReportFilters from '../report-filters'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ preset?: string; start?: string; end?: string; status?: string; page?: string }>
}

type ProductRow = {
  id: string
  name: string
  part_number: string | null
  sku: string | null
  status: string | null
  price: number | null
  income_account: string | null
  created_at: string
}

const PRODUCT_STATUS_OPTIONS = [
  { value: 'draft',     label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'disabled',  label: 'Disabled' },
]

export default async function ProductsReport(props: PageProps) {
  try {
    return await PageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[reports-products] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (reports-products)</h1>
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
  const page = parseInt(sp.page ?? '1', 10) || 1

  function buildBase() {
    let q = supabase
      .from('products')
      .select('id, name, part_number, sku, status, price, income_account, created_at', { count: 'exact' })
      .eq('organization_id', org!.id)
      .gte('created_at', range.start)
      .lte('created_at', range.end)
    if (sp.status && sp.status !== 'all') q = q.eq('status', sp.status)
    return q
  }

  const { count: totalCount } = await buildBase().limit(1)
  const total = totalCount ?? 0
  const { from, to, pageCount, page: safePage } = paginate(total, page)
  const { data: rows } = await buildBase()
    .order('name', { ascending: true })
    .range(from, to) as { data: ProductRow[] | null; error: unknown }

  const exportParams = new URLSearchParams()
  if (sp.preset) exportParams.set('preset', sp.preset)
  if (sp.start)  exportParams.set('start', sp.start)
  if (sp.end)    exportParams.set('end', sp.end)
  if (sp.status) exportParams.set('status', sp.status)

  return (
    <ReportShell
      orgSlug={slug}
      title="Products"
      totalRows={total}
      page={safePage}
      pageCount={pageCount}
      exportHref={`/api/reports/products?org=${org.id}&${exportParams}`}
      extraFilters={<ReportFilters filters={[{ key: 'status', label: 'Status', options: PRODUCT_STATUS_OPTIONS }]} />}
    >
      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Part #</th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Income Account</th>
                <th className="px-3 py-2 text-left">Status</th>
                {canSeePricing && <th className="px-3 py-2 text-right">Price</th>}
                <th className="px-3 py-2 text-left">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-[#1A1A1A]">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.part_number || '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.sku || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{r.income_account || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="rounded px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                      {r.status || '—'}
                    </span>
                  </td>
                  {canSeePricing && (
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.price != null ? `$${(r.price / 100).toFixed(2)}` : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2 text-gray-500">
                    {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center text-sm text-gray-500">
          No products match the selected filters.
        </div>
      )}
    </ReportShell>
  )
}
