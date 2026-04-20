import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { QuoteStatus } from '@/types/database'
import { checkPermission } from '@/lib/check-permission'
import QuoteTable, { type QuoteRow } from './quote-table'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string }>
}

export default async function QuotesPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { status: statusFilter } = await searchParams
  const supabase = await createClient()

  // Fetch org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')

  // Fetch quotes with joined customer data
  type QuoteDbRow = {
    id: string
    quote_number: number
    title: string
    status: QuoteStatus
    created_at: string
    customer_id: string | null
    customers: {
      first_name: string
      last_name: string
      company_name: string | null
      email: string | null
      phone: string | null
    } | null
  }

  let quoteQuery = supabase
    .from('quotes')
    .select('id, quote_number, title, status, created_at, customer_id, customers(first_name, last_name, company_name, email, phone)')
    .eq('organization_id', org.id)
    .order('quote_number', { ascending: false })

  // Status filter from ?status=… search param. 'all' (or unset) means no filter.
  if (statusFilter && statusFilter !== 'all') {
    quoteQuery = quoteQuery.eq('status', statusFilter)
  }

  const { data: quoteRows } = await quoteQuery as { data: QuoteDbRow[] | null; error: unknown }

  // Fetch line item totals per quote
  type LineItemRow = { quote_id: string; quantity: number; unit_price: number }
  const quoteIds = (quoteRows ?? []).map((q) => q.id)

  let lineItemRows: LineItemRow[] = []
  if (quoteIds.length > 0) {
    const { data } = await supabase
      .from('quote_line_items')
      .select('quote_id, quantity, unit_price')
      .in('quote_id', quoteIds) as { data: LineItemRow[] | null; error: unknown }
    lineItemRows = data ?? []
  }

  // Aggregate totals per quote
  const totalsMap = new Map<string, number>()
  for (const item of lineItemRows) {
    totalsMap.set(item.quote_id, (totalsMap.get(item.quote_id) ?? 0) + item.quantity * item.unit_price)
  }

  const quotes: QuoteRow[] = (quoteRows ?? []).map((r) => ({
    id: r.id,
    quote_number: r.quote_number,
    title: r.title,
    status: r.status,
    created_at: r.created_at,
    total: totalsMap.get(r.id) ?? 0,
    customer: r.customers ? {
      first_name: r.customers.first_name,
      last_name: r.customers.last_name,
      company_name: r.customers.company_name,
      email: r.customers.email,
      phone: r.customers.phone,
    } : null,
  }))

  const total = quotes.length

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-700">Quotes</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quotes</h1>
            <p className="mt-1 text-sm text-gray-500">
              {total === 0
                ? 'No quotes yet.'
                : `${total} quote${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <Link
            href={`/dashboard/${slug}/quotes/new`}
            className="rounded-md bg-qm-fuchsia px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Create Quote
          </Link>
        </div>
      </div>

      {/* Content — always render the table so the filter tabs stay visible
          even when the current filter has zero matches. The table renders
          its own empty state. */}
      <QuoteTable quotes={quotes} orgId={org.id} orgSlug={org.slug} activeFilter={statusFilter ?? 'all'} canSeePricing={canSeePricing} />
    </div>
  )
}
