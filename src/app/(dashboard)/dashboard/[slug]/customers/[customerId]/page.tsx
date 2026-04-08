import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { JobStatus, QuoteStatus } from '@/types/database'
import CustomerDetailClient from './customer-detail-client'
import { QUOTE_STATUS_STYLES } from '../../quotes/format'

const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  new: 'New', in_progress: 'In Progress', proof_review: 'Proof Review',
  ready_for_pickup: 'Ready for Pickup', completed: 'Completed',
}
const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  new: 'bg-qm-lime-light text-qm-lime', in_progress: 'bg-qm-fuchsia-light text-qm-fuchsia',
  proof_review: 'bg-qm-gray-light text-qm-gray', ready_for_pickup: 'bg-qm-black/5 text-qm-black',
  completed: 'bg-qm-lime-light text-qm-lime',
}
// QUOTE_STATUS_COLORS now lives in quotes/format.ts so all 12 Phase 8
// statuses share the same palette. Re-aliased here to keep the rest of
// this file's references unchanged.
const QUOTE_STATUS_COLORS: Record<QuoteStatus, string> = QUOTE_STATUS_STYLES

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type PageProps = { params: Promise<{ slug: string; customerId: string }> }

export default async function CustomerDetailPage({ params }: PageProps) {
  const { slug, customerId } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations').select('id, name, slug').eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
  if (!org) notFound()

  type CustomerRow = {
    id: string; first_name: string; last_name: string; company_name: string | null
    email: string | null; phone: string | null; notes: string | null; created_at: string
  }
  const { data: customer } = await supabase
    .from('customers')
    .select('id, first_name, last_name, company_name, email, phone, notes, created_at')
    .eq('id', customerId).eq('organization_id', org.id)
    .maybeSingle() as { data: CustomerRow | null; error: unknown }
  if (!customer) notFound()

  // Fetch jobs for this customer
  type JobRow = { id: string; job_number: number; title: string; status: JobStatus; created_at: string }
  const { data: jobRows } = await supabase
    .from('jobs').select('id, job_number, title, status, created_at')
    .eq('organization_id', org.id).eq('customer_id', customerId)
    .order('created_at', { ascending: false }) as { data: JobRow[] | null; error: unknown }

  // Fetch quotes for this customer
  type QuoteRow = { id: string; quote_number: number; title: string; status: QuoteStatus; created_at: string }
  const { data: quoteRows } = await supabase
    .from('quotes').select('id, quote_number, title, status, created_at')
    .eq('organization_id', org.id).eq('customer_id', customerId)
    .order('created_at', { ascending: false }) as { data: QuoteRow[] | null; error: unknown }

  // Fetch quote line item totals
  type LineItemRow = { quote_id: string; quantity: number; unit_price: number }
  const quoteIds = (quoteRows ?? []).map((q) => q.id)
  const perQuoteTotals = new Map<string, number>()
  if (quoteIds.length > 0) {
    const { data: items } = await supabase
      .from('quote_line_items').select('quote_id, quantity, unit_price')
      .in('quote_id', quoteIds) as { data: LineItemRow[] | null; error: unknown }
    for (const item of items ?? []) {
      perQuoteTotals.set(item.quote_id, (perQuoteTotals.get(item.quote_id) ?? 0) + item.quantity * item.unit_price)
    }
  }

  const jobs = jobRows ?? []
  const quotes = (quoteRows ?? []).map((q) => ({ ...q, total: perQuoteTotals.get(q.id) ?? 0 }))

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumbs + Back */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <a href={`/dashboard/${slug}/customers`} className="hover:text-gray-700">Customers</a>
          <span>/</span>
          <span className="text-gray-700">{customer.first_name} {customer.last_name}</span>
        </div>
        <a href={`/dashboard/${slug}/customers`} className="inline-flex items-center gap-1.5 text-sm font-medium text-qm-gray hover:text-qm-black transition-colors">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Customers
        </a>
      </div>

      {/* Customer header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-qm-black">{customer.first_name} {customer.last_name}</h1>
        {customer.company_name && <p className="text-sm text-qm-gray mt-1">{customer.company_name}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-qm-gray">
          {customer.email && (
            <a href={`mailto:${customer.email}`} className="flex items-center gap-1.5 hover:text-qm-lime">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              {customer.email}
            </a>
          )}
          {customer.phone && (
            <a href={`tel:${customer.phone}`} className="flex items-center gap-1.5 hover:text-qm-lime">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
              </svg>
              {customer.phone}
            </a>
          )}
          <span>Added {formatDate(customer.created_at)}</span>
        </div>
      </div>

      {/* Editable fields + Notes — client component */}
      <CustomerDetailClient
        customerId={customer.id}
        orgId={org.id}
        orgSlug={slug}
        initialData={{
          first_name: customer.first_name,
          last_name: customer.last_name,
          company_name: customer.company_name,
          email: customer.email,
          phone: customer.phone,
          notes: customer.notes,
        }}
      />

      {/* Jobs */}
      <div className="mt-8 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-bold text-qm-black">Jobs</h2>
          <span className="text-xs font-medium text-qm-gray">{jobs.length}</span>
        </div>
        {jobs.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-qm-gray">No jobs for this customer</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {jobs.map((j) => (
              <a key={j.id} href={`/dashboard/${slug}/jobs/${j.id}`} className="flex items-center justify-between px-6 py-3 hover:bg-qm-surface/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-qm-gray">#{j.job_number}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${JOB_STATUS_COLORS[j.status]}`}>
                      {JOB_STATUS_LABELS[j.status]}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-qm-black truncate">{j.title}</p>
                </div>
                <span className="ml-4 shrink-0 text-xs text-qm-gray">{formatDate(j.created_at)}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Quotes */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-bold text-qm-black">Quotes</h2>
          <span className="text-xs font-medium text-qm-gray">{quotes.length}</span>
        </div>
        {quotes.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-qm-gray">No quotes for this customer</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {quotes.map((q) => (
              <a key={q.id} href={`/dashboard/${slug}/quotes`} className="flex items-center justify-between px-6 py-3 hover:bg-qm-surface/50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-qm-gray">Q-{q.quote_number}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${QUOTE_STATUS_COLORS[q.status]}`}>
                      {q.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-qm-black truncate">{q.title}</p>
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <p className="text-sm font-semibold text-qm-black">${formatCents(q.total)}</p>
                  <p className="text-xs text-qm-gray">{formatDate(q.created_at)}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
