import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { QuoteStatus } from '@/types/database'
import QuoteDetailClient from './quote-detail-client'
import { convertToSalesOrder } from './convert-action'
import type { EmailTemplate } from '../actions'
import { checkPermission } from '@/lib/check-permission'
import { dbOrThrow } from '@/lib/db'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function QuoteDetailPage(props: PageProps) {
  try {
    return await QuoteDetailPageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[quotes-detail] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (quotes-detail)</h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function QuoteDetailPageInner({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
  if (!org) notFound()

  type QuoteRow = {
    id: string
    quote_number: number
    title: string
    description: string | null
    status: QuoteStatus
    created_at: string
    expires_at: string | null
    terms: string | null
    notes: string | null
    subtotal: number | null
    tax_total: number | null
    total: number | null
    customer_id: string | null
    converted_to_so_id: string | null
    due_date: string | null
    sales_rep_id: string | null
    po_number: string | null
    install_address: string | null
    production_notes: string | null
    customers: {
      first_name: string
      last_name: string
      company_name: string | null
      email: string | null
      phone: string | null
      street: string | null
      city: string | null
      state: string | null
      zip: string | null
      status: string | null
      terms: string | null
      credit_limit: number | null
      special_notes: string | null
      background_info: string | null
    } | null
  }

  // Phase 8 columns (expires_at, terms, notes, subtotal, tax_total, total,
  // converted_to_so_id) may not exist yet if migration 018b hasn't been
  // applied. Fetch core fields first, then try the extended set.
  let quote: QuoteRow | null = null

  const { data: q1, error: e1 } = await supabase
    .from('quotes')
    .select(`
      id, quote_number, title, description, status, created_at,
      expires_at, terms, notes, subtotal, tax_total, total,
      customer_id, converted_to_so_id,
      due_date, sales_rep_id, po_number, install_address, production_notes,
      customers(first_name, last_name, company_name, email, phone, street, city, state, zip, status, terms, credit_limit, special_notes, background_info)
    `)
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: QuoteRow | null; error: { message: string } | null }

  if (q1) {
    quote = q1
    // Always fetch customer via service client to ensure fresh data (bypasses RLS join cache)
    if (q1.customer_id) {
      const { data: custRow } = await createServiceClient()
        .from('customers')
        .select('first_name, last_name, company_name, email, phone, street, city, state, zip, status, terms, credit_limit, special_notes, background_info')
        .eq('id', q1.customer_id)
        .maybeSingle()
      if (custRow) {
        quote = { ...q1, customers: custRow as typeof q1.customers }
      }
    }
  } else if (e1?.message?.includes('does not exist')) {
    // Fallback: fetch only columns from the original 002_quotes migration
    const { data: q2 } = await supabase
      .from('quotes')
      .select(`
        id, quote_number, title, description, status, created_at,
        customer_id,
        customers(first_name, last_name, company_name, email, phone, street, city, state, zip, status, terms, credit_limit, special_notes, background_info)
      `)
      .eq('id', id)
      .eq('organization_id', org.id)
      .maybeSingle() as { data: Omit<QuoteRow, 'expires_at' | 'terms' | 'notes' | 'subtotal' | 'tax_total' | 'total' | 'converted_to_so_id'> | null; error: unknown }

    if (q2) {
      quote = {
        ...q2,
        expires_at: null,
        terms: null,
        notes: null,
        subtotal: null,
        tax_total: null,
        total: null,
        converted_to_so_id: null,
        due_date: null,
        sales_rep_id: null,
        po_number: null,
        install_address: null,
        production_notes: null,
      }
    }
  }

  if (!quote) notFound()

  type LineItemRow = {
    id: string
    product_id: string | null
    description: string
    width: number | null
    height: number | null
    quantity: number
    unit_price: number
    discount_percent: number | null
    total_price: number
    taxable: boolean | null
    sort_order: number | null
    modifier_values: Record<string, boolean | number> | null
  }

  // modifier_values is a jsonb column added in migration 030. Fall back to
  // a fetch without it if the column doesn't exist yet on the live DB.
  let lineItems: LineItemRow[] | null = null
  {
    const { data, error } = await supabase
      .from('quote_line_items')
      .select('id, product_id, description, width, height, quantity, unit_price, discount_percent, total_price, taxable, sort_order, modifier_values')
      .eq('quote_id', id)
      .order('sort_order', { ascending: true }) as { data: LineItemRow[] | null; error: { message?: string } | null }
    if (data) {
      lineItems = data
    } else if (error?.message?.includes('modifier_values')) {
      const { data: legacy } = await supabase
        .from('quote_line_items')
        .select('id, product_id, description, width, height, quantity, unit_price, discount_percent, total_price, taxable, sort_order')
        .eq('quote_id', id)
        .order('sort_order', { ascending: true }) as { data: Omit<LineItemRow, 'modifier_values'>[] | null; error: unknown }
      lineItems = (legacy ?? []).map((li) => ({ ...li, modifier_values: null }))
    }
  }

  // Products for the line item picker (edit mode).
  type ProductOption = { id: string; name: string; formula: string | null }
  const { data: products } = await supabase
    .from('products')
    .select('id, name, formula')
    .eq('organization_id', org.id)
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(2000) as { data: ProductOption[] | null; error: unknown }

  // Fetch materials for each product used in line items, via product_items.
  const productIds = [...new Set(
    (lineItems ?? []).map((li) => li.product_id).filter(Boolean) as string[],
  )]

  const materialMap = new Map<string, string>()
  if (productIds.length > 0) {
    try {
      type ProductMaterialRow = {
        product_id: string
        materials: { name: string } | null
      }
      const { data: productMats } = await supabase
        .from('product_items')
        .select('product_id, materials(name)')
        .in('product_id', productIds)
        .eq('item_type', 'Material')
        .limit(500) as { data: ProductMaterialRow[] | null; error: unknown }

      for (const pm of productMats ?? []) {
        if (pm.product_id && pm.materials?.name && !materialMap.has(pm.product_id)) {
          materialMap.set(pm.product_id, pm.materials.name)
        }
      }
    } catch {
      // product_items table may not exist yet — skip material lookup
    }
  }

  // Fetch team members for the sales rep dropdown.
  // organization_members.user_id FKs to auth.users (not profiles), and the
  // profiles RLS policy is own-row-only — PostgREST embedded joins don't work.
  // Use the service client to bypass RLS, same pattern as team-members/page.tsx.
  type RawMemberRow = { user_id: string }
  const { data: memberRows } = await supabase
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', org.id)
    .in('role', ['owner', 'admin', 'member']) as { data: RawMemberRow[] | null; error: unknown }

  const memberUserIds = (memberRows ?? []).map(m => m.user_id)
  const service = createServiceClient()
  const nameMap = new Map<string, string>()

  if (memberUserIds.length > 0) {
    type ProfileRow = { id: string; full_name: string | null }
    const { data: profileRows } = await service
      .from('profiles')
      .select('id, full_name')
      .in('id', memberUserIds) as { data: ProfileRow[] | null; error: unknown }
    for (const p of profileRows ?? []) {
      if (p.full_name) nameMap.set(p.id, p.full_name)
    }
    const missing = memberUserIds.filter(id => !nameMap.has(id))
    if (missing.length > 0) {
      const { data: { users: authUsers } } = await service.auth.admin.listUsers()
      for (const u of authUsers ?? []) {
        if (!nameMap.has(u.id) && u.email) nameMap.set(u.id, u.email)
      }
    }
  }

  const teamMembers = memberUserIds
    .map(id => ({ id, name: nameMap.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Resolve sales rep name for display
  const salesRepName = quote.sales_rep_id
    ? teamMembers.find((m) => m.id === quote.sales_rep_id)?.name ?? null
    : null

  // If this quote was converted to a sales order, fetch its number.
  type SoRef = { id: string; so_number: number; created_at: string }
  let salesOrder: SoRef | null = null
  if (quote.converted_to_so_id) {
    const { data: so } = await supabase
      .from('sales_orders')
      .select('id, so_number, created_at')
      .eq('id', quote.converted_to_so_id)
      .maybeSingle() as { data: SoRef | null; error: unknown }
    salesOrder = so
  }

  // Fetch active email templates for the send-email modal.
  let emailTemplates: EmailTemplate[] = []
  try {
    const { data: tplRows } = await supabase
      .from('email_templates')
      .select('id, name, subject, body, trigger_event')
      .eq('organization_id', org.id)
      .eq('is_active', true)
      .order('name', { ascending: true }) as {
        data: EmailTemplate[] | null
        error: unknown
      }
    emailTemplates = tplRows ?? []
  } catch {
    // email_templates table may not exist yet — skip
  }

  // Fetch modifier definitions for the org so saved modifier_values on
  // line items render with display names and types. Always fetched so
  // freshly-added line items show chips without a page refresh.
  type ModifierDefRow = {
    id: string
    system_lookup_name: string | null
    display_name: string
    modifier_type: string
    units: string | null
  }
  const { data: modRows } = await supabase
    .from('modifiers')
    .select('id, system_lookup_name, display_name, modifier_type, units')
    .eq('organization_id', org.id) as { data: ModifierDefRow[] | null; error: unknown }
  const modifierDefs: ModifierDefRow[] = modRows ?? []

  // Check if user can see pricing columns
  const { allowed: canSeePricing } = await checkPermission(org.id, 'quotes.see_pricing')
  const { allowed: canExportPdf }  = await checkPermission(org.id, 'quotes.export_pdf')

  // Resolve org role for owner/admin gating
  const { data: membershipRow } = await supabase
    .from('organization_members').select('role')
    .eq('organization_id', org.id)
    .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  const isOwnerOrAdmin = membershipRow?.role === 'owner' || membershipRow?.role === 'admin'

  // Fetch contact_id (column added in migration 058 — may not exist yet)
  let quoteContactId: string | null = null
  let quoteContactName: string | null = null
  let quoteContactEmail: string | null = null
  let quoteContactPhone: string | null = null
  try {
    const { data: cRow } = await supabase
      .from('quotes').select('contact_id')
      .eq('id', quote.id).maybeSingle() as { data: { contact_id?: string | null } | null; error: unknown }
    quoteContactId = cRow?.contact_id ?? null
    if (quoteContactId) {
      const { data: ccRow } = await supabase
        .from('customer_contacts').select('full_name, email, phone')
        .eq('id', quoteContactId).maybeSingle() as { data: { full_name: string; email?: string | null; phone?: string | null } | null; error: unknown }
      quoteContactName = ccRow?.full_name ?? null
      quoteContactEmail = ccRow?.email ?? null
      quoteContactPhone = ccRow?.phone ?? null
    }
  } catch { /* migration 058 not yet applied — skip */ }

  // Fetch shipping data for the quote
  type ShipAddrRow = { id: string; label: string | null; street: string | null; city: string | null; state: string | null; zip: string | null; country: string; is_default: boolean }
  type ShipProfileRow = { id: string; name: string; length_in: number | null; width_in: number | null; height_in: number | null; max_weight_lbs: number | null; is_active: boolean }
  let quoteShippingAddresses: ShipAddrRow[] = []
  let quoteShippingProfiles: ShipProfileRow[] = []
  try {
    const { data: spData } = await supabase
      .from('shipping_profiles').select('id, name, length_in, width_in, height_in, max_weight_lbs, is_active')
      .eq('organization_id', org.id).order('name') as { data: ShipProfileRow[] | null; error: unknown }
    quoteShippingProfiles = spData ?? []
  } catch { /* migration guard */ }
  if (quote.customer_id) {
    try {
      const { data: saData } = await supabase
        .from('shipping_addresses').select('id, label, street, city, state, zip, country, is_default')
        .eq('customer_id', quote.customer_id).eq('organization_id', org.id)
        .order('is_default', { ascending: false }).order('created_at', { ascending: true }) as { data: ShipAddrRow[] | null; error: unknown }
      quoteShippingAddresses = saData ?? []
    } catch { /* migration 076 guard */ }
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/quotes`} className="hover:text-gray-700">Quotes</Link>
        <span>/</span>
        <span className="text-gray-700">Q-{String(quote.quote_number).padStart(4, '0')}</span>
      </div>

      {/* Convert to SO — plain server action form, no client JS needed */}
      {(quote.status === 'approved' || quote.status === 'customer_review' || quote.status === 'internally_approved') && !quote.converted_to_so_id && (
        <form action={convertToSalesOrder} className="mb-6">
          <input type="hidden" name="quoteId" value={quote.id} />
          <input type="hidden" name="orgId" value={org.id} />
          <input type="hidden" name="orgSlug" value={slug} />
          <button
            type="submit"
            className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Convert to Sales Order
          </button>
        </form>
      )}

      <QuoteDetailClient
        orgId={org.id}
        orgSlug={slug}
        quote={{
          id: quote.id,
          quote_number: quote.quote_number,
          title: quote.title,
          description: quote.description,
          status: quote.status,
          created_at: quote.created_at,
          expires_at: quote.expires_at,
          terms: quote.terms,
          notes: quote.notes,
          subtotal: quote.subtotal ?? 0,
          tax_total: quote.tax_total ?? 0,
          total: quote.total ?? 0,
          due_date: quote.due_date,
          sales_rep_id: quote.sales_rep_id,
          po_number: quote.po_number,
          install_address: quote.install_address,
          production_notes: quote.production_notes,
          customer: quote.customers
            ? {
                first_name: quote.customers.first_name,
                last_name: quote.customers.last_name,
                company_name: quote.customers.company_name,
                email: quote.customers.email,
                phone: quote.customers.phone,
                street: quote.customers.street ?? null,
                city: quote.customers.city ?? null,
                state: quote.customers.state ?? null,
                zip: quote.customers.zip ?? null,
                status: quote.customers.status ?? null,
                terms: quote.customers.terms ?? null,
                credit_limit: quote.customers.credit_limit ?? null,
                special_notes: quote.customers.special_notes ?? null,
                background_info: quote.customers.background_info ?? null,
              }
            : null,
        }}
        lineItems={(lineItems ?? []).map((li) => ({
          id: li.id,
          product_id: li.product_id,
          description: li.description,
          width: li.width,
          height: li.height,
          quantity: li.quantity,
          unit_price: li.unit_price,
          discount_percent: Number(li.discount_percent ?? 0),
          total_price: li.total_price,
          taxable: li.taxable !== false,
          sort_order: li.sort_order ?? 0,
          material_name: li.product_id ? materialMap.get(li.product_id) ?? null : null,
          modifier_values: li.modifier_values ?? undefined,
        }))}
        products={products ?? []}
        salesOrder={salesOrder}
        teamMembers={teamMembers}
        salesRepName={salesRepName}
        emailTemplates={emailTemplates}
        canSeePricing={canSeePricing}
        canExportPdf={canExportPdf}
        modifierDefs={modifierDefs}
        shippingAddresses={quoteShippingAddresses}
        shippingProfiles={quoteShippingProfiles}
        initialCustomerId={quote.customer_id}
        initialContactId={quoteContactId}
        initialContactName={quoteContactName}
        initialContactEmail={quoteContactEmail}
        initialContactPhone={quoteContactPhone}
        isOwnerOrAdmin={isOwnerOrAdmin}
      />
    </div>
  )
}
