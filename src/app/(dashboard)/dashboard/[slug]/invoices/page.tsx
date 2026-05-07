import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatInvNumber, formatCents, INV_STATUS_STYLES, INV_STATUS_LABELS, INV_FILTER_TABS } from './format'
import { checkPermission } from '@/lib/check-permission'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string; overdue_bucket?: string }>
}

type OverdueBucket = '0-30' | '31-60' | '61-90' | '90+'

function bucketDateRange(bucket: OverdueBucket): { gte?: string; lt?: string } {
  // Returns ISO date strings for due_date range. Bucket = days past due:
  //   0-30  → due_date in [today-30, today)
  //   31-60 → due_date in [today-60, today-30)
  //   61-90 → due_date in [today-90, today-60)
  //   90+   → due_date < today-90
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const dayMs = 86_400_000
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const offset = (days: number) => iso(new Date(today.getTime() - days * dayMs))
  switch (bucket) {
    case '0-30':  return { gte: offset(30), lt: iso(today) }
    case '31-60': return { gte: offset(60), lt: offset(30) }
    case '61-90': return { gte: offset(90), lt: offset(60) }
    case '90+':   return { lt: offset(90) }
  }
}

export default async function Page({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) notFound()

  // Permission gate — only owner + accounting + sales (with override) can view invoices
  const { allowed } = await checkPermission(org.id, 'invoices.view')
  if (!allowed) {
    return (
      <div className="p-8 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view invoices. Contact your organization owner to request access.
        </div>
      </div>
    )
  }

  let query = supabase
    .from('invoices')
    .select('id, invoice_number, status, total, balance_due, due_date, created_at, customer_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .order('invoice_number', { ascending: false })

  let countQuery = supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org.id)

  const filter = sp.status
  const bucket = sp.overdue_bucket as OverdueBucket | undefined

  if (filter && filter !== 'all') {
    query = query.eq('status', filter) as typeof query
    countQuery = countQuery.eq('status', filter) as typeof countQuery
  }

  if (bucket && (bucket === '0-30' || bucket === '31-60' || bucket === '61-90' || bucket === '90+')) {
    const range = bucketDateRange(bucket)
    // Overdue ⇒ unpaid + non-cancelled + non-draft
    query = query.not('status', 'in', '(paid,cancelled,draft)') as typeof query
    countQuery = countQuery.not('status', 'in', '(paid,cancelled,draft)') as typeof countQuery
    if (range.gte) {
      query = query.gte('due_date', range.gte) as typeof query
      countQuery = countQuery.gte('due_date', range.gte) as typeof countQuery
    }
    if (range.lt) {
      query = query.lt('due_date', range.lt) as typeof query
      countQuery = countQuery.lt('due_date', range.lt) as typeof countQuery
    }
  }

  const [rowsRes, countRes] = await Promise.all([query.limit(1000), countQuery])
  const rows = rowsRes.data
  const totalCount = countRes.count ?? 0
  const invoices = (rows ?? []) as {
    id: string; invoice_number: number; status: string; total: number; balance_due: number
    due_date: string | null; created_at: string
    customers: { first_name: string; last_name: string; company_name: string | null } | null
  }[]

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
          <span>/</span>
          <span className="text-gray-700">Invoices</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <p className="mt-1 text-sm text-gray-500">
          {totalCount === 0 ? 'No invoices yet.' : `${totalCount} invoice${totalCount === 1 ? '' : 's'}`}
          {bucket && (
            <span className="ml-2 inline-flex items-center gap-2 rounded-full bg-qm-fuchsia/10 px-2.5 py-0.5 text-xs font-semibold text-qm-fuchsia">
              Overdue {bucket} days
              <Link href={`/dashboard/${slug}/invoices`} className="text-[#888] hover:text-qm-fuchsia">×</Link>
            </span>
          )}
        </p>
        {invoices.length === 1000 && totalCount > 1000 && (
          <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 inline-block">
            Showing 1000 of {totalCount} — use filter to narrow results
          </p>
        )}
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {INV_FILTER_TABS.map((tab) => {
          const active = (filter ?? 'all') === tab.value
          const href = tab.value === 'all' ? `/dashboard/${slug}/invoices` : `/dashboard/${slug}/invoices?status=${tab.value}`
          return (
            <Link key={tab.value} href={href} className={`inline-flex items-center px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-qm-fuchsia text-qm-fuchsia' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
              {tab.label}
            </Link>
          )
        })}
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <p className="text-sm font-medium text-gray-900">No invoices{filter && filter !== 'all' ? ` with status "${filter}"` : ''}</p>
          <p className="mt-1 text-sm text-gray-500">Invoices are created when a Sales Order is completed.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">#</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Customer</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Total</th>
                <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Balance</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-6 py-4">
                    <Link href={`/dashboard/${slug}/invoices/${inv.id}`} className="text-sm font-medium text-qm-fuchsia hover:underline">
                      {formatInvNumber(inv.invoice_number, inv.created_at)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {inv.customers
                      ? `${inv.customers.first_name} ${inv.customers.last_name}${inv.customers.company_name ? ` (${inv.customers.company_name})` : ''}`
                      : <span className="text-gray-300">&mdash;</span>}
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900 text-right">${formatCents(inv.total)}</td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-right">
                    <span className={inv.balance_due > 0 ? 'text-red-600' : 'text-green-600'}>${formatCents(inv.balance_due)}</span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${INV_STATUS_STYLES[inv.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {INV_STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                    {inv.due_date ? new Date(inv.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
