import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import Link from 'next/link'
import type { SalesOrderStatus } from '@/types/database'
import { checkPermission } from '@/lib/check-permission'
import SoDetailClient from './so-detail-client'
import JobDetailPanel from './job-detail-panel'
import { resolveJobsForLineItems } from '@/lib/jobs/resolve-jobs-for-line-items'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'
import EntityAuditPanel from '../../_widgets/entity-audit-panel'
import DepositReceivedCard from '@/components/payments/deposit-received-card'

type PageProps = {
  params: Promise<{ slug: string; id: string }>
  searchParams?: Promise<Record<string, string | undefined>>
}

export default async function SalesOrderDetailPage(props: PageProps) {
  try {
    return await SalesOrderDetailPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('sales-orders-detail', err)
  }
}

async function SalesOrderDetailPageInner({ params, searchParams }: PageProps) {
  const { slug, id } = await params
  const sp = searchParams ? await searchParams : {}
  const shipmentSaved = sp.shipment_saved === '1'
  const shipmentError = sp.shipment_error ? decodeURIComponent(sp.shipment_error) : undefined
  const warning = sp.warning ? decodeURIComponent(sp.warning) : undefined
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
  if (!org) notFound()

  type SoRow = {
    id: string
    so_number: number
    title: string | null
    status: SalesOrderStatus
    total: number | null
    notes: string | null
    quote_id: string | null
    customer_id: string | null
    created_at: string
    updated_at: string
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
      shipping_method: string | null
      terms: string | null
    } | null
  }

  const so = await dbOrThrow(
    supabase
      .from('sales_orders')
      .select(`
        id, so_number, title, status, total, notes, quote_id, customer_id,
        created_at, updated_at,
        customers(first_name, last_name, company_name, email, phone, street, city, state, zip, shipping_method, terms)
      `)
      .eq('id', id)
      .eq('organization_id', org.id)
      .maybeSingle()
  ) as SoRow | null

  if (!so) notFound()

  // Was 'quotes.see_pricing' — wrong key for this page. permissions.ts
  // defines a dedicated 'sales_orders.see_pricing' for exactly this
  // purpose; both keys happen to resolve identically for every role today
  // so this wasn't visibly broken, but it's the correct one to use going
  // forward (and what "reuse the existing see_pricing permission" means
  // for a page that's actually a sales order, not a quote).
  const { allowed: canSeePricing } = await checkPermission(org.id, 'sales_orders.see_pricing')
  const { allowed: canExportPdf }  = await checkPermission(org.id, 'quotes.export_pdf')

  // Owner/admin role
  const soMemberRow = await dbOrThrow(
    supabase
      .from('organization_members').select('role')
      .eq('organization_id', org.id)
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id ?? '')
      .maybeSingle()
  ) as { role: string } | null
  const canReassignSoCustomer = ['owner', 'admin', 'member'].includes(soMemberRow?.role ?? '')

  // contact_id (migration 058)
  let soContactId: string | null = null
  let soContactName: string | null = null
  let soContactEmail: string | null = null
  let soContactPhone: string | null = null
  try {
    const { data: cRow } = await supabase
      .from('sales_orders').select('contact_id')
      .eq('id', id).maybeSingle() as { data: { contact_id?: string | null } | null; error: unknown }
    soContactId = cRow?.contact_id ?? null
    if (soContactId) {
      const { data: ccRow } = await supabase
        .from('customer_contacts').select('full_name, email, phone')
        .eq('id', soContactId).maybeSingle() as { data: { full_name?: string; email?: string | null; phone?: string | null } | null; error: unknown }
      soContactName = ccRow?.full_name ?? null
      soContactEmail = ccRow?.email ?? null
      soContactPhone = ccRow?.phone ?? null
    }
  } catch { /* migration 058 not yet applied */ }

  // Fetch parent quote info if linked
  type QuoteRef = { id: string; quote_number: number; title: string; created_at: string }
  let parentQuote: QuoteRef | null = null
  if (so.quote_id) {
    const q = await dbOrThrow(
      supabase
        .from('quotes')
        .select('id, quote_number, title, created_at')
        .eq('id', so.quote_id)
        .maybeSingle()
    ) as QuoteRef | null
    parentQuote = q
  }

  // Fetch line items from the linked quote
  type SoLineItem = {
    id: string; description: string; quantity: number; unit_price: number
    total_price: number; discount_percent: number | null; taxable: boolean | null
    sort_order: number | null
  }
  let soLineItems: SoLineItem[] = []
  if (so.quote_id) {
    const liData = await dbOrThrow(
      supabase
        .from('quote_line_items')
        .select('id, description, quantity, unit_price, total_price, discount_percent, taxable, sort_order')
        .eq('quote_id', so.quote_id)
        .order('sort_order')
    ) as SoLineItem[] | null
    soLineItems = liData ?? []
  }

  // Line item -> the job that covers it (migration 121's job-per-line-item
  // grain, with a fallback to the SO's one legacy job for line items that
  // predate it — see resolveJobsForLineItems for why that fallback
  // exists; shared with uploadProofForLineItem so the two can't drift).
  // Replaces the old separate `jobs` list + `lineItemJobIds` id-only map —
  // this unified list has no standalone Jobs table anymore, so nothing
  // else on this page needs the full jobs array.
  const jobByLineItemId = await resolveJobsForLineItems(supabase, org.id, so.id, soLineItems.map((li) => li.id))

  // One pre-rendered JobDetailPanel per UNIQUE job (not per line item) —
  // a legacy job can be the fallback for several line items at once, and
  // there's no reason to fetch/render its panel more than once. Each
  // panel is a Server Component instance; the same rendered element can
  // be handed to multiple rows in the client tree below without re-running
  // its data fetch per row.
  const uniqueJobIds = [...new Set(Object.values(jobByLineItemId).map((j) => j.id))]
  const jobPanelsByJobId: Record<string, ReactNode> = {}
  for (const jobId of uniqueJobIds) {
    jobPanelsByJobId[jobId] = <JobDetailPanel key={jobId} jobId={jobId} orgId={org.id} orgSlug={slug} />
  }

  // jobIds for the proof_versions query below still needs every job
  // belonging to this SO, not just the ones with a line-item mapping —
  // kept as its own lightweight id-only query since jobByLineItemId only
  // carries jobs actually reachable from a line item.
  const jobIdsForSo = await dbOrThrow(
    supabase.from('jobs').select('id').eq('sales_order_id', so.id).eq('organization_id', org.id)
  ) as { id: string }[] | null

  // Fetch shipments for this SO
  type ShipmentRow = {
    id: string
    carrier: string | null
    tracking_number: string | null
    shipped_date: string | null
    estimated_delivery: string | null
    notes: string | null
    status: string
    created_at: string
    shipping_method_id: string | null
    shipping_profile_id: string | null
    weight_lbs: number | null
    length_in: number | null
    width_in: number | null
    height_in: number | null
    quoted_rate: number | null
    actual_cost: number | null
    label_url: string | null
  }
  let shipments: ShipmentRow[] = []
  try {
    const { data: shipData } = await supabase
      .from('shipments')
      .select('id, carrier, tracking_number, shipped_date, estimated_delivery, notes, status, created_at, shipping_method_id, shipping_profile_id, weight_lbs, length_in, width_in, height_in, quoted_rate, actual_cost, label_url')
      .eq('sales_order_id', id)
      .order('created_at', { ascending: false }) as { data: ShipmentRow[] | null; error: unknown }
    shipments = shipData ?? []
  } catch { /* shipments table not yet applied */ }

  // Fetch shipping methods (used to label shipments in the read-only table)
  type ShipMethodRow = { id: string; name: string; carrier: string | null; is_active: boolean }
  let shippingMethods: ShipMethodRow[] = []
  try {
    const { data: mData } = await supabase
      .from('shipping_methods').select('id, name, carrier, is_active').eq('organization_id', org.id).order('name')
    shippingMethods = (mData ?? []) as ShipMethodRow[]
  } catch { /* table not yet applied */ }

  // Each line item's MOST RECENT tagged proof_version, regardless of
  // status — bucketed afterward into "ready to send" (pending) vs
  // "already responded" (approved/rejected). Fetching all statuses (not
  // just pending, like before) is what backs the 4th state Ruben flagged:
  // without it, a line item whose latest proof was approved/rejected fell
  // straight through to "no ready proof" and looked identical to a line
  // item nothing had ever been uploaded for, so staff had no visibility
  // from this page into what the customer actually said.
  type ProofRow = {
    id: string; quote_line_item_id: string | null; file_name: string
    version_number: number; created_at: string; status: string
    customer_feedback: string | null; customer_markup_file_url: string | null
    customer_responded_at: string | null
  }
  let readyProofs: { id: string; quoteLineItemId: string; fileName: string; versionNumber: number; lastSentAt: string | null }[] = []
  let respondedProofs: { id: string; quoteLineItemId: string; fileName: string; versionNumber: number; status: 'approved' | 'rejected'; customerFeedback: string | null; customerMarkupFileUrl: string | null; customerRespondedAt: string | null }[] = []
  if ((jobIdsForSo ?? []).length > 0) {
    const jobIds = (jobIdsForSo ?? []).map((j) => j.id)
    const proofRows = await dbOrThrow(
      supabase
        .from('proof_versions')
        .select('id, quote_line_item_id, file_name, version_number, created_at, status, customer_feedback, customer_markup_file_url, customer_responded_at')
        .in('job_id', jobIds)
        .not('quote_line_item_id', 'is', null)
        .order('version_number', { ascending: false })
    ) as ProofRow[] | null

    const latestByLineItem = new Map<string, ProofRow>()
    for (const p of proofRows ?? []) {
      if (!p.quote_line_item_id) continue
      // Descending version order above means the first row seen per line
      // item is already its highest version, whatever its status.
      if (!latestByLineItem.has(p.quote_line_item_id)) latestByLineItem.set(p.quote_line_item_id, p)
    }

    const pending = Array.from(latestByLineItem.values()).filter((p) => p.status === 'pending')
    const responded = Array.from(latestByLineItem.values()).filter((p) => p.status === 'approved' || p.status === 'rejected')

    const lastSentByProof = new Map<string, string>()
    if (pending.length > 0) {
      try {
        const { data: sendItemRows } = await supabase
          .from('proof_send_items')
          .select('proof_version_id, proof_sends(sent_at)')
          .in('proof_version_id', pending.map((p) => p.id)) as {
            data: { proof_version_id: string; proof_sends: { sent_at: string } | { sent_at: string }[] | null }[] | null
          }
        for (const row of sendItemRows ?? []) {
          const sendRel = Array.isArray(row.proof_sends) ? row.proof_sends[0] : row.proof_sends
          const sentAt = sendRel?.sent_at
          if (!sentAt) continue
          const prev = lastSentByProof.get(row.proof_version_id)
          if (!prev || sentAt > prev) lastSentByProof.set(row.proof_version_id, sentAt)
        }
      } catch { /* migration 119 not yet applied */ }
    }

    readyProofs = pending.map((p) => ({
      id: p.id,
      quoteLineItemId: p.quote_line_item_id as string,
      fileName: p.file_name,
      versionNumber: p.version_number,
      lastSentAt: lastSentByProof.get(p.id) ?? null,
    }))

    respondedProofs = responded.map((p) => ({
      id: p.id,
      quoteLineItemId: p.quote_line_item_id as string,
      fileName: p.file_name,
      versionNumber: p.version_number,
      status: p.status as 'approved' | 'rejected',
      customerFeedback: p.customer_feedback,
      customerMarkupFileUrl: p.customer_markup_file_url,
      customerRespondedAt: p.customer_responded_at,
    }))
  }

  // Deposit received -- live query against payment_applications, no
  // denormalized column on sales_orders (deliberate schema decision,
  // this is the follow-up UI work for it).
  const paymentMethods = (await dbOrThrow(
    supabase.from('payment_methods').select('id, name, type').eq('organization_id', org.id).order('sort_order')
  ) ?? []) as { id: string; name: string; type: string }[]

  const { data: depositAppsSum } = await supabase
    .from('payment_applications')
    .select('amount_applied')
    .eq('sales_order_id', so.id) as { data: { amount_applied: number }[] | null }
  const depositReceivedCents = (depositAppsSum ?? []).reduce((sum, r) => sum + r.amount_applied, 0)

  let depositRequiredCents = 0
  if (so.customers?.terms) {
    const { data: tc } = await supabase
      .from('term_codes')
      .select('down_payment_percent')
      .eq('organization_id', org.id)
      .eq('name', so.customers.terms)
      .maybeSingle() as { data: { down_payment_percent: number | null } | null }
    const pct = Number(tc?.down_payment_percent ?? 0)
    if (pct > 0) depositRequiredCents = Math.round((so.total ?? 0) * pct / 100)
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/sales-orders`} className="hover:text-gray-700">Sales Orders</Link>
        <span>/</span>
        <span className="text-gray-700">SO-{String(so.so_number).padStart(4, '0')}</span>
      </div>

      <SoDetailClient
        orgId={org.id}
        orgSlug={slug}
        salesOrder={{
          id: so.id,
          so_number: so.so_number,
          title: so.title ?? '',
          status: so.status,
          total: so.total ?? 0,
          notes: so.notes,
          created_at: so.created_at,
          updated_at: so.updated_at,
          customer_id: so.customer_id,
          customer: so.customers ?? null,
        }}
        parentQuote={parentQuote}
        lineItems={soLineItems}
        jobByLineItemId={jobByLineItemId}
        jobPanelsByJobId={jobPanelsByJobId}
        canSeePricing={canSeePricing}
        canExportPdf={canExportPdf}
        initialContactId={soContactId}
        initialContactName={soContactName}
        initialContactEmail={soContactEmail}
        initialContactPhone={soContactPhone}
        canReassignCustomer={canReassignSoCustomer}
        shipments={shipments}
        shipmentSaved={shipmentSaved}
        shipmentError={shipmentError}
        warning={warning}
        shippingMethods={shippingMethods}
        readyProofs={readyProofs}
        respondedProofs={respondedProofs}
      />

      {so.customer_id && (
        <div className="mt-6 max-w-sm">
          <DepositReceivedCard
            orgId={org.id}
            orgSlug={slug}
            customerId={so.customer_id}
            target={{ type: 'sales_order', id: so.id }}
            depositReceivedCents={depositReceivedCents}
            depositRequiredCents={depositRequiredCents}
            paymentMethods={paymentMethods}
          />
        </div>
      )}

      <div className="mt-6">
        <EntityAuditPanel
          supabase={supabase}
          orgId={org.id}
          orgSlug={slug}
          entityType="sales_order"
          entityId={so.id}
          orderThreadId={so.quote_id ?? so.id}
        />
      </div>
    </div>
  )
}
