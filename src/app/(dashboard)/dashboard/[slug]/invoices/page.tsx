import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatInvNumber, formatCents, INV_STATUS_STYLES, INV_STATUS_LABELS, INV_FILTER_TABS } from './format'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string }>
}

export default async function Page({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  const { data: orgRow } = await supabase.from('organizations').select('id, name').eq('slug', slug).single()
  const org = orgRow as { id: string; name: string } | null
  if (!org) notFound()

  let query = supabase
    .from('invoices')
    .select('id, invoice_number, status, total, balance_due, due_date, created_at, customer_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .order('invoice_number', { ascending: false })

  const filter = sp.status
  if (filter && filter !== 'all') {
    query = query.eq('status', filter) as typeof query
  }

  const { data: rows } = await query.limit(500)
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
          {invoices.length === 0 ? 'No invoices yet.' : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
        </p>
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
