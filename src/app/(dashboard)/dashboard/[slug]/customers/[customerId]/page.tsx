import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import CustomerDetailClient from './customer-detail-client'
import CustomerContactsSection from './customer-contacts'
import CustomerActionMenu from './customer-action-menu'
import ShippingAddressesSection from './shipping-addresses-section'
import CustomerTabsSection from './CustomerTabsSection'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
    email: string | null; phone: string | null; phone2: string | null; phone_ext: string | null
    notes: string | null; created_at: string
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
    sms_consent: boolean | null
    portal_enabled: boolean | null
    portal_tier_id: string | null
    shipping_method: string | null
  }

  const { data: customer } = await supabase
    .from('customers')
    .select(`id, first_name, last_name, company_name, email, phone, phone2, phone_ext, notes, created_at,
      legal_name, sales_rep, industry, lead_source, customer_group, status, is_active,
      street, street2, city, state, zip, country,
      secondary_street, secondary_city, secondary_state, secondary_zip, secondary_country,
      terms, taxable, tax_exempt_code, tax_exempt_expires, credit_limit,
      pricing_level, discount_percent, website, allow_credit_card_payments,
      background_info, special_notes, sms_consent, portal_enabled, portal_tier_id, shipping_method`)
    .eq('id', customerId).eq('organization_id', org.id)
    .maybeSingle() as { data: CustomerRow | null; error: unknown }
  if (!customer) notFound()

  type PortalTierOption = { id: string; name: string }
  let portalTiers: PortalTierOption[] = []
  try {
    const { data: ptData } = await supabase
      .from('portal_tiers')
      .select('id, name')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('name') as { data: PortalTierOption[] | null; error: unknown }
    portalTiers = ptData ?? []
  } catch { /* migration 097 not yet applied */ }

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  const isOwnerOrAdmin = membership?.role === 'owner' || membership?.role === 'admin'

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
    .order('is_primary', { ascending: false })
    .order('last_name', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true }) as { data: ContactRow[] | null; error: unknown }

  const primaryContact = (contactRows ?? []).find((c) => c.is_primary) ?? null

  // Open jobs only (exclude completed + cancelled)
  type JobRow = { id: string; job_number: number; title: string; status: string; created_at: string }
  const { data: openJobRows } = await supabase
    .from('jobs').select('id, job_number, title, status, created_at')
    .eq('organization_id', org.id).eq('customer_id', customerId)
    .neq('status', 'completed').neq('status', 'cancelled')
    .order('created_at', { ascending: false }) as { data: JobRow[] | null; error: unknown }

  type QuoteRow = { id: string; quote_number: number; title: string; status: string; created_at: string }
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

  type InvoiceRow = { id: string; invoice_number: number; status: string; total: number; due_date: string | null; created_at: string }
  const { data: invoiceRows } = await supabase
    .from('invoices').select('id, invoice_number, status, total, due_date, created_at')
    .eq('organization_id', org.id).eq('customer_id', customerId)
    .order('created_at', { ascending: false }) as { data: InvoiceRow[] | null; error: unknown }

  // Fetch shipping methods for dropdown
  type ShipMethodRow = { id: string; name: string }
  let shippingMethods: ShipMethodRow[] = []
  try {
    const { data: smData } = await supabase
      .from('shipping_methods')
      .select('id, name')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('name') as { data: ShipMethodRow[] | null; error: unknown }
    shippingMethods = smData ?? []
  } catch { /* migration 098 not yet applied */ }

  // Fetch saved shipping addresses
  type ShipAddrRow = { id: string; label: string | null; street: string | null; city: string | null; state: string | null; zip: string | null; country: string; is_default: boolean }
  let shippingAddresses: ShipAddrRow[] = []
  try {
    const { data: saData } = await supabase
      .from('shipping_addresses')
      .select('id, label, street, city, state, zip, country, is_default')
      .eq('customer_id', customerId).eq('organization_id', org.id)
      .order('is_default', { ascending: false }).order('created_at', { ascending: true }) as { data: ShipAddrRow[] | null; error: unknown }
    shippingAddresses = saData ?? []
  } catch { /* migration 076 not yet applied */ }

  const openJobs = openJobRows ?? []
  const quotes = (quoteRows ?? []).map((q) => ({ ...q, total: perQuoteTotals.get(q.id) ?? 0 }))
  const invoices = invoiceRows ?? []

  const headerName = customer.company_name || `${customer.first_name} ${customer.last_name}`

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
        <span>/</span>
        <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
        <span>/</span>
        <a href={`/dashboard/${slug}/customers`} className="hover:text-gray-700">Customers</a>
        <span>/</span>
        <span className="text-gray-700">{headerName}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-qm-black">{headerName}</h1>
            {customer.is_active === false && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
                Inactive
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-gray-400">Added {formatDate(customer.created_at)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-gray-600">
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
                {customer.phone_ext && <span className="text-gray-400 ml-1">ext {customer.phone_ext}</span>}
              </a>
            )}
          </div>
        </div>
        <CustomerActionMenu
          customerId={customer.id}
          orgId={org.id}
          orgSlug={slug}
          customerName={headerName}
          isActive={customer.is_active}
          isOwnerOrAdmin={isOwnerOrAdmin}
        />
      </div>

      {/* Editable cards — Address, Customer Details, [Contacts slot], Account Info */}
      <CustomerDetailClient
        customerId={customer.id}
        orgId={org.id}
        orgSlug={slug}
        contactsSlot={
          <CustomerContactsSection
            customerId={customer.id}
            orgId={org.id}
            orgSlug={slug}
            initialContacts={contactRows ?? []}
          />
        }
        initialPrimaryContact={primaryContact ? {
          full_name: primaryContact.full_name,
          email: primaryContact.email,
          phone: primaryContact.phone,
          title: primaryContact.title,
        } : null}
        initialData={{
          first_name: customer.first_name,
          last_name: customer.last_name,
          company_name: customer.company_name,
          email: customer.email,
          phone: customer.phone,
          phone2: customer.phone2,
          phone_ext: customer.phone_ext,
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
          sms_consent: customer.sms_consent,
          portal_enabled: customer.portal_enabled,
          portal_tier_id: customer.portal_tier_id,
          shipping_method: customer.shipping_method,
        }}
        portalTiers={portalTiers}
        shippingMethods={shippingMethods}
      />

      {/* Shipping Addresses */}
      <ShippingAddressesSection
        customerId={customer.id}
        orgId={org.id}
        orgSlug={slug}
        initialAddresses={shippingAddresses}
      />

      {/* Customer 360 tabs: Open Jobs / Quotes / Invoices / Transactions / Payments / Tasks / Leads */}
      <CustomerTabsSection
        customerId={customer.id}
        orgSlug={slug}
        initialOpenJobs={openJobs}
        initialQuotes={quotes}
        initialInvoices={invoices}
      />
    </div>
  )
}
