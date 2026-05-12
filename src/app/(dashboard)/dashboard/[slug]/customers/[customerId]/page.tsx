import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { JobStatus, QuoteStatus } from '@/types/database'
import CustomerDetailClient from './customer-detail-client'
import CustomerContactsSection from './customer-contacts'
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
    legal_name: string | null; sales_rep: string | null; industry: string | null
    lead_source: string | null; customer_group: string | null; status: string | null
    is_active: boolean | null
    street: string | null; street2: string | null
    city: string | null; state: string | null; zip: string | null
    secondary_street: string | null; secondary_city: string | null
    secondary_state: string | null; secondary_zip: string | null
    country: string | null; secondary_country: string | null
    terms: string | null; taxable: boolean | null; tax_exempt_code: string | null
    tax_exempt_expires: string | null; credit_limit: number | null
    pricing_level: string | null; discount_percent: number | null
    website: string | null; allow_credit_card_payments: boolean | null
    background_info: string | null; special_notes: string | null
  }
  const { data: customer } = await supabase
    .from('customers')
    .select(`id, first_name, last_name, company_name, email, phone, notes, created_at,
      legal_name, sales_rep, industry, lead_source, customer_group, status, is_active,
      street, street2, city, state, zip, country,
      secondary_street, secondary_city, secondary_state, secondary_zip, secondary_country,
      terms, taxable, tax_exempt_code, tax_exempt_expires, credit_limit,
      pricing_level, discount_percent, website, allow_credit_card_payments,
      background_info, special_notes`)
    .eq('id', customerId).eq('organization_id', org.id)
    .maybeSingle() as { data: CustomerRow | null; error: unknown }
  if (!customer) notFound()

  type ContactRow = {
    id: string; full_name: string; first_name: string | null; last_name: string | null
    email: string | null; email2: string | null; phone: string | null
    phone2: string | null; phone_ext: string | null; title: string | null
    is_primary: boolean | null; is_ap_contact: boolean | null; is_active: boolean | null
  }
  const { data: contactRows } = await supabase
    .from('customer_contacts')
    .select('id, full_name, first_name, last_name, email, email2, phone, phone2, phone_ext, title, is_primary, is_ap_contact, is_active')
    .eq('customer_id', customerId)
    .eq('organization_id', org.id)
    .order('last_name', { ascending: true, nullsFirst: false })
    .order('first_name', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true }) as { data: ContactRow[] | null; error: unknown }

  type JobRow = { id: string; job_number: number; title: string; status: JobStatus; created_at: string }
  const { data: jobRows } = await supabase
    .from('jobs').select('id, job_number, title, status, created_at')
    .eq('organization_id', org.id).eq('customer_id', customerId)
    .order('created_at', { ascending: false }) as { data: JobRow[] | null; error: unknown }

  type QuoteRow = { id: string; quote_number: number; title: string; status: QuoteStatus; created_at: string }
  const { data: quoteRows } = await supabase
    .from('quotes').select('id, quote_number, title, status, created_at')
    .eq('organization_id', org.id).eq('customer_id', customerId)
    .order('created_at', { ascending: false }) as { data: QuoteRow[] | null; error: unknown }

  type LineItemRow = { quote_id: string; quantity: number; unit_price: number }
  const quoteIds = (quoteRows ?? []).map((q) => q.id)
  const perQuoteTotals = new Map<string, number>()
  if (quoteIds.length > 0) {
    const { data: items } = await supabase
      .from('quote_line_items').select('quote_id, quantity, unit_price')
      .in('quote_id', quoteIds) as { data: LineItemRow[] | null; error: unknown }
    for (const item of items ?? [])
      perQuoteTotals.set(item.quote_id, (perQuoteTotals.get(item.quote_id) ?? 0) + item.quantity * item.unit_price)
  }

  const jobs = jobRows ?? []
  const quotes = (quoteRows ?? []).map((q) => ({ ...q, total: perQuoteTotals.get(q.id) ?? 0 }))

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumbs */}
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

      {/* Header */}
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

      {/* Editable cards — Customer Details, Address, Account Info, Notes */}
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
          legal_name: customer.legal_name,
          sales_rep: customer.sales_rep,
          industry: customer.industry,
          lead_source: customer.lead_source,
          customer_group: customer.customer_group,
          status: customer.status,
          is_active: customer.is_active,
          street: customer.street,
          street2: customer.street2,
          city: customer.city,
          state: customer.state,
          zip: customer.zip,
          secondary_street: customer.secondary_street,
          secondary_city: customer.secondary_city,
          secondary_state: customer.secondary_state,
          secondary_zip: customer.secondary_zip,
          country: customer.country,
          secondary_country: customer.secondary_country,
          terms: customer.terms,
          taxable: customer.taxable,
          tax_exempt_code: customer.tax_exempt_code,
          tax_exempt_expires: customer.tax_exempt_expires,
          credit_limit: customer.credit_limit,
          pricing_level: customer.pricing_level,
          discount_percent: customer.discount_percent,
          website: customer.website,
          allow_credit_card_payments: customer.allow_credit_card_payments,
          background_info: customer.background_info,
          special_notes: customer.special_notes,
        }}
      />

      {/* Contacts */}
      <CustomerContactsSection
        customerId={customer.id}
        orgId={org.id}
        orgSlug={slug}
        initialContacts={contactRows ?? []}
      />

      {/* Jobs */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
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
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${JOB_STATUS_COLORS[j.status]}`}>{JOB_STATUS_LABELS[j.status]}</span>
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
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${QUOTE_STATUS_COLORS[q.status]}`}>{q.status}</span>
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
