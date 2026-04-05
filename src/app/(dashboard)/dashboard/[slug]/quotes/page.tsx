import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { QuoteStatus } from '@/types/database'
import QuoteTable, { type QuoteRow } from './quote-table'
import CreateQuoteForm from './create-quote-form'

type PageProps = { params: Promise<{ slug: string }> }

export default async function QuotesPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // Fetch org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

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
    } | null
  }

  const { data: quoteRows } = await supabase
    .from('quotes')
    .select('id, quote_number, title, status, created_at, customer_id, customers(first_name, last_name, company_name)')
    .eq('organization_id', org.id)
    .order('quote_number', { ascending: false }) as { data: QuoteDbRow[] | null; error: unknown }

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
    customer: r.customers ?? null,
  }))

  // Fetch customers for the create form dropdown
  type CustomerRow = { id: string; first_name: string; last_name: string; company_name: string | null }
  const { data: customerRows } = await supabase
    .from('customers')
    .select('id, first_name, last_name, company_name')
    .eq('organization_id', org.id)
    .order('last_name', { ascending: true }) as { data: CustomerRow[] | null; error: unknown }

  const customers = customerRows ?? []
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
          <CreateQuoteForm orgId={org.id} orgSlug={org.slug} customers={customers} />
        </div>
      </div>

      {/* Content */}
      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-qm-lime-light text-qm-lime">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <p className="mt-4 text-sm font-medium text-gray-900">No quotes yet</p>
          <p className="mt-1 text-sm text-gray-500">Create your first quote to send to a customer.</p>
        </div>
      ) : (
        <QuoteTable quotes={quotes} orgId={org.id} orgSlug={org.slug} />
      )}
    </div>
  )
}
