import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkPermission } from '@/lib/check-permission'
import { notFound, unstable_rethrow } from 'next/navigation'
import CustomerDetailClient from './customer-detail-client'
import CustomerContactsSection from './customer-contacts'
import CustomerActionMenu from './customer-action-menu'
import ShippingAddressesSection from './shipping-addresses-section'
import CustomerTabsSection from './CustomerTabsSection'
import CustomerDetailsCollapsible from './customer-details-collapsible'
import { dbOrThrow, DbError } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMoney(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700',
  prospect: 'bg-yellow-50 text-yellow-700',
  closable: 'bg-blue-50 text-blue-700',
  sold: 'bg-qm-lime-light text-qm-lime-dark',
}

type PageProps = { params: Promise<{ slug: string; customerId: string }> }

export default async function CustomerDetailPage(props: PageProps) {
  try {
    return await CustomerDetailPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('customers-detail', err)
  }
}

async function CustomerDetailPageInner({ params }: PageProps) {
  const { slug, customerId } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
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
    vat_number: string | null; other_info: string | null
    sms_consent: boolean | null
    portal_enabled: boolean | null
    portal_tier_id: string | null
    shipping_method: string | null
  }

  const customer = await dbOrThrow(
    supabase
      .from('customers')
      .select(`id, first_name, last_name, company_name, email, phone, phone2, phone_ext, notes, created_at,
      legal_name, sales_rep, industry, lead_source, customer_group, status, is_active,
      street, street2, city, state, zip, country,
      secondary_street, secondary_city, secondary_state, secondary_zip, secondary_country,
      terms, taxable, tax_exempt_code, tax_exempt_expires, credit_limit,
      pricing_level, discount_percent, website, allow_credit_card_payments,
      background_info, special_notes, vat_number, other_info, sms_consent, portal_enabled, portal_tier_id, shipping_method`)
      .eq('id', customerId).eq('organization_id', org.id)
      .maybeSingle()
  ) as CustomerRow | null
  if (!customer) notFound()

  type PortalTierOption = { id: string; name: string }
  let portalTiers: PortalTierOption[] = []
  const { allowed: canManagePortalTiers } = await checkPermission(org.id, 'portal_tiers.manage')
  if (canManagePortalTiers) {
    // Service client — portal_tiers has RLS enabled with zero policies, so
    // a normal cookie-bound client can never see any row here regardless of
    // the checkPermission() result above. Only fetched at all when the
    // caller is authorized, so the field stays fully absent (not just
    // empty) for everyone else.
    const service = createServiceClient()
    const { data: ptData } = await service
      .from('portal_tiers')
      .select('id, name')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('name') as { data: PortalTierOption[] | null; error: unknown }
    portalTiers = ptData ?? []
  }

  const membership = await dbOrThrow(
    supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', org.id)
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()
  ) as { role: string } | null
  const isOwnerOrAdmin = membership?.role === 'owner' || membership?.role === 'admin'

  type ContactRow = {
    id: string; full_name: string; first_name: string | null; last_name: string | null
    email: string | null; email2: string | null; phone: string | null
    phone2: string | null; phone_ext: string | null; title: string | null
    is_primary: boolean | null; is_ap_contact: boolean | null; is_active: boolean | null
    is_staff_contact: boolean; portal_user_id: string | null
    portal_invited_at: string | null; portal_invite_expires_at: string | null
  }
  const contactRows = await dbOrThrow(
    supabase
      .from('customer_contacts')
      .select('id, full_name, first_name, last_name, email, email2, phone, phone2, phone_ext, title, is_primary, is_ap_contact, is_active, is_staff_contact, portal_user_id, portal_invited_at, portal_invite_expires_at')
      .eq('customer_id', customerId)
      .eq('organization_id', org.id)
      .order('is_primary', { ascending: false })
      .order('last_name', { ascending: true, nullsFirst: false })
      .order('full_name', { ascending: true })
  ) as ContactRow[] | null

  const primaryContact = (contactRows ?? []).find((c) => c.is_primary) ?? null

  // Open jobs only (exclude completed). Note: job_status has no 'cancelled'
  // member (see supabase/migrations/003_jobs.sql) -- a .neq('status',
  // 'cancelled') filter here always errored (22P02, invalid enum literal),
  // silently for years since the old query never checked its error.
  type JobRow = { id: string; job_number: number; title: string; status: string; created_at: string }
  const openJobRows = await dbOrThrow(
    supabase
      .from('jobs').select('id, job_number, title, status, created_at')
      .eq('organization_id', org.id).eq('customer_id', customerId)
      .neq('status', 'completed')
      .order('created_at', { ascending: false })
  ) as JobRow[] | null

  type QuoteRow = { id: string; quote_number: number; title: string; status: string; created_at: string }
  const quoteRows = await dbOrThrow(
    supabase
      .from('quotes').select('id, quote_number, title, status, created_at')
      .eq('organization_id', org.id).eq('customer_id', customerId)
      .order('created_at', { ascending: false })
  ) as QuoteRow[] | null

  type LineItemRow = { quote_id: string; quantity: number; unit_price: number }
  const quoteIds = (quoteRows ?? []).map((q) => q.id)
  const perQuoteTotals = new Map<string, number>()
  if (quoteIds.length > 0) {
    const items = await dbOrThrow(
      supabase
        .from('quote_line_items').select('quote_id, quantity, unit_price')
        .in('quote_id', quoteIds)
    ) as LineItemRow[] | null
    for (const item of items ?? [])
      perQuoteTotals.set(item.quote_id, (perQuoteTotals.get(item.quote_id) ?? 0) + item.quantity * item.unit_price)
  }

  type InvoiceRow = { id: string; invoice_number: number; status: string; total: number; due_date: string | null; created_at: string }
  const invoiceRows = await dbOrThrow(
    supabase
      .from('invoices').select('id, invoice_number, status, total, due_date, created_at')
      .eq('organization_id', org.id).eq('customer_id', customerId)
      .order('created_at', { ascending: false })
  ) as InvoiceRow[] | null

  // Total job/SO counts (all statuses) for the delete guard below -- mirrors
  // exactly what the deleteCustomer server action itself checks, so the
  // button's enabled state never lies about whether delete will succeed.
  const [jobCountRes, soCountRes] = await Promise.all([
    supabase.from('jobs').select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id).eq('customer_id', customerId),
    supabase.from('sales_orders').select('id', { count: 'exact', head: true })
      .eq('organization_id', org.id).eq('customer_id', customerId),
  ])
  if (jobCountRes.error) throw new DbError(jobCountRes.error)
  if (soCountRes.error) throw new DbError(soCountRes.error)

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

  // Compute outstanding balance and overdue amount from invoice statuses
  const balance = invoices
    .filter((inv) => ['sent', 'partial', 'overdue'].includes(inv.status))
    .reduce((sum, inv) => sum + (inv.total ?? 0), 0)
  const overdueAmount = invoices
    .filter((inv) => inv.status === 'overdue')
    .reduce((sum, inv) => sum + (inv.total ?? 0), 0)

  // Header contact: prefer primary contact, fall back to customer-level email/phone
  const headerContact = primaryContact
    ? { name: primaryContact.full_name as string | null, email: primaryContact.email, phone: primaryContact.phone }
    : { name: null as string | null, email: customer.email, phone: customer.phone }

  const headerName = customer.company_name || `${customer.first_name} ${customer.last_name}`

  // Same "linked to X" check the deleteCustomer server action itself
  // enforces -- computed here purely so the Delete button can reflect the
  // real reason instead of always rendering as if it might work.
  const jobCount = jobCountRes.count ?? 0
  const soCount = soCountRes.count ?? 0
  const linkedRecords: string[] = []
  if (quotes.length > 0) linkedRecords.push(`${quotes.length} quote${quotes.length === 1 ? '' : 's'}`)
  if (jobCount > 0) linkedRecords.push(`${jobCount} job${jobCount === 1 ? '' : 's'}`)
  if (soCount > 0) linkedRecords.push(`${soCount} sales order${soCount === 1 ? '' : 's'}`)
  if (invoices.length > 0) linkedRecords.push(`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`)

  return (
    <div>
      <div className="px-8 pt-8 max-w-6xl">
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

      {/* Compact header strip — name + badges on line 1, financial + contact summary on line 2 */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold text-qm-black">{headerName}</h1>
            {customer.is_active === false && (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
                Inactive
              </span>
            )}
            {customer.status != null && STATUS_BADGE_CLASSES[customer.status] != null && (
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE_CLASSES[customer.status]}`}>
                {customer.status}
              </span>
            )}
          </div>
          {/* Summary row: balance · overdue · primary contact info */}
          {(balance > 0 || overdueAmount > 0 || headerContact.name || headerContact.email || headerContact.phone) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-gray-600">
              {balance > 0 && (
                <span className="font-medium">{fmtMoney(balance)} balance</span>
              )}
              {overdueAmount > 0 && balance > 0 && <span className="text-gray-300 select-none">·</span>}
              {overdueAmount > 0 && (
                <span className="font-semibold text-red-600">{fmtMoney(overdueAmount)} overdue</span>
              )}
              {headerContact.name && (balance > 0 || overdueAmount > 0) && <span className="text-gray-300 select-none">·</span>}
              {headerContact.name && (
                <span className="font-medium text-qm-black">{headerContact.name}</span>
              )}
              {headerContact.email && (headerContact.name || balance > 0 || overdueAmount > 0) && <span className="text-gray-300 select-none">·</span>}
              {headerContact.email && (
                <a href={`mailto:${headerContact.email}`} className="hover:text-qm-lime hover:underline">
                  {headerContact.email}
                </a>
              )}
              {headerContact.phone && (headerContact.email || headerContact.name || balance > 0 || overdueAmount > 0) && <span className="text-gray-300 select-none">·</span>}
              {headerContact.phone && (
                <a href={`tel:${headerContact.phone}`} className="hover:text-qm-lime hover:underline">
                  {headerContact.phone}
                </a>
              )}
            </div>
          )}
        </div>
        <CustomerActionMenu
          customerId={customer.id}
          orgId={org.id}
          orgSlug={slug}
          customerName={headerName}
          isActive={customer.is_active}
          isOwnerOrAdmin={isOwnerOrAdmin}
          linkedRecords={linkedRecords}
        />
      </div>

      {/* Collapsible details section — collapsed by default so tabs are immediately visible */}
      <CustomerDetailsCollapsible>
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
            vat_number: customer.vat_number,
            other_info: customer.other_info,
            sms_consent: customer.sms_consent,
            portal_enabled: customer.portal_enabled,
            portal_tier_id: customer.portal_tier_id,
            shipping_method: customer.shipping_method,
          }}
          portalTiers={portalTiers}
          shippingMethods={shippingMethods}
          canManagePortalTiers={canManagePortalTiers}
        />
      </CustomerDetailsCollapsible>
      </div>
      <div className="px-8 pb-8 max-w-6xl">
        <CustomerTabsSection
          customerId={customer.id}
          orgSlug={slug}
          initialOpenJobs={openJobs}
          initialQuotes={quotes}
          initialInvoices={invoices}
          contactsSlot={
            <CustomerContactsSection
              customerId={customer.id}
              orgId={org.id}
              orgSlug={slug}
              initialContacts={contactRows ?? []}
              inTab
            />
          }
          contactCount={contactRows?.length ?? 0}
          shippingAddressesSlot={
            <ShippingAddressesSection
              customerId={customer.id}
              orgId={org.id}
              orgSlug={slug}
              initialAddresses={shippingAddresses}
              inTab
            />
          }
          shippingAddressCount={shippingAddresses.length}
        />
      </div>
    </div>
  )
}
