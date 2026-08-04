import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound, unstable_rethrow } from 'next/navigation'
import Link from 'next/link'
import { checkPermission } from '@/lib/check-permission'
import { getCustomerShippingInfo } from '../actions'
import type { SoSearchRow } from '../../sales-orders/actions'
import { formatSoNumber } from '../../sales-orders/format'
import { SHIP_STATUS_STYLES, SHIP_STATUS_LABELS, formatShipDate } from '../format'
import ShipmentFormClient, { type ShipmentFormInitial } from '../shipment-form-client'
import { dbOrThrow } from '@/lib/db'
import { renderPageError } from '@/lib/page-error'

type PageProps = {
  params: Promise<{ slug: string; id: string }>
  searchParams: Promise<{ error?: string }>
}

type ShipmentRow = {
  id: string
  status: string
  tracking_number: string | null
  actual_cost: number | null
  quoted_rate: number | null
  carrier: string | null
  created_at: string
  sales_order_id: string | null
  customer_id: string | null
  shipping_method_id: string | null
  shipping_profile_id: string | null
  weight_lbs: number | null
  length_in: number | null
  width_in: number | null
  height_in: number | null
  ship_to_name: string | null
  ship_to_street: string | null
  ship_to_city: string | null
  ship_to_state: string | null
  ship_to_zip: string | null
  ship_to_phone: string | null
  label_url: string | null
  sales_orders: {
    id: string
    so_number: number
    title: string | null
    status: SoSearchRow['status']
    total: number | null
    created_at: string
    customer_id: string | null
    customers: { first_name: string; last_name: string; company_name: string | null } | null
    shipments: { id: string }[] | null
  } | null
  customers: { first_name: string; last_name: string; company_name: string | null } | null
  shipping_methods: { name: string; carrier: string | null } | null
  shipping_profiles: { name: string } | null
}

const DB_SELECT = `
  id, status, tracking_number, actual_cost, quoted_rate, carrier, created_at,
  sales_order_id, customer_id, shipping_method_id, shipping_profile_id,
  weight_lbs, length_in, width_in, height_in,
  ship_to_name, ship_to_street, ship_to_city, ship_to_state, ship_to_zip, ship_to_phone, label_url,
  sales_orders(id, so_number, title, status, total, created_at, customer_id, customers(first_name, last_name, company_name), shipments(id)),
  customers(first_name, last_name, company_name),
  shipping_methods(name, carrier),
  shipping_profiles(name)
`

function custName(c: { first_name: string; last_name: string; company_name: string | null } | null): string | null {
  if (!c) return null
  return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || null
}

export default async function ShipmentDetailPage(props: PageProps) {
  try {
    return await ShipmentDetailPageInner(props)
  } catch (err) {
    unstable_rethrow(err)
    return renderPageError('shipping-detail', err)
  }
}

async function ShipmentDetailPageInner({ params, searchParams }: PageProps) {
  const { slug, id } = await params
  const sp = await searchParams
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
  if (!org) notFound()

  // profiles RLS only allows selecting your own row (auth.uid() = id), so
  // team-member lookups (picker + assignee display) need the service client.
  const service = createServiceClient()

  const { allowed: canView } = await checkPermission(org.id, 'shipping.view')
  if (!canView) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">Shipment</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to view shipments.
        </div>
      </div>
    )
  }

  const shipment = await dbOrThrow(
    supabase
      .from('shipments')
      .select(DB_SELECT)
      .eq('organization_id', org.id)
      .eq('id', id)
      .maybeSingle()
  ) as ShipmentRow | null
  if (!shipment) notFound()

  const soHref = shipment.sales_order_id ? `/dashboard/${slug}/sales-orders/${shipment.sales_order_id}` : null
  const custLabel = custName(shipment.sales_order_id ? shipment.sales_orders?.customers ?? null : shipment.customers)
  const linkedLabel = shipment.sales_order_id && shipment.sales_orders
    ? formatSoNumber(shipment.sales_orders.so_number, shipment.sales_orders.created_at)
    : shipment.customer_id && custLabel
      ? custLabel
      : 'Office / Standalone'

  const { allowed: canEdit } = await checkPermission(org.id, 'shipping.create')
  const isPending = shipment.status === 'pending'

  const crumbs = (
    <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
      <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
      <span>/</span>
      <Link href={`/dashboard/${slug}/shipping`} className="hover:text-gray-700">Shipping</Link>
      <span>/</span>
      <span className="text-gray-700">{linkedLabel}</span>
    </div>
  )

  if (isPending && canEdit) {
    const customerIdForInfo = shipment.customer_id ?? shipment.sales_orders?.customer_id ?? null
    const resolvedCustomer = customerIdForInfo ? await getCustomerShippingInfo(org.id, customerIdForInfo) : null

    const selectedSo: SoSearchRow | null = shipment.sales_order_id && shipment.sales_orders
      ? {
          id: shipment.sales_orders.id,
          so_number: shipment.sales_orders.so_number,
          title: shipment.sales_orders.title,
          status: shipment.sales_orders.status,
          total: shipment.sales_orders.total,
          created_at: shipment.sales_orders.created_at,
          customer_id: shipment.sales_orders.customer_id,
          customers: shipment.sales_orders.customers,
          shipments: shipment.sales_orders.shipments,
        }
      : null

    type ShipMethodRow = { id: string; name: string; carrier: string | null; is_active: boolean }
    type ShipProfileRow = { id: string; name: string; length_in: number | null; width_in: number | null; height_in: number | null; max_weight_lbs: number | null; is_active: boolean }
    type TeamMemberRow = { id: string; full_name: string | null }

    const [mRows, pRows, tRows, taskData] = await Promise.all([
      dbOrThrow(supabase.from('shipping_methods').select('id, name, carrier, is_active').eq('organization_id', org.id).eq('is_active', true).order('name')),
      dbOrThrow(supabase.from('shipping_profiles').select('id, name, length_in, width_in, height_in, max_weight_lbs, is_active').eq('organization_id', org.id).eq('is_active', true).order('name')),
      dbOrThrow(service.from('profiles').select('id, full_name').eq('organization_id', org.id).order('full_name')),
      dbOrThrow(supabase.from('tasks').select('description, assigned_to').eq('shipment_id', shipment.id).maybeSingle()),
    ])
    const shippingMethods = (mRows ?? []) as ShipMethodRow[]
    const shippingProfiles = (pRows ?? []) as ShipProfileRow[]
    const teamMembers = (tRows ?? []) as TeamMemberRow[]
    const linkedTask = taskData as { description: string | null; assigned_to: string | null } | null

    const initial: ShipmentFormInitial = {
      linkMode: shipment.sales_order_id ? 'so' : shipment.customer_id ? 'customer' : 'none',
      selectedSo,
      resolvedCustomer,
      shipToName: shipment.ship_to_name ?? '',
      shipToStreet: shipment.ship_to_street ?? '',
      shipToCity: shipment.ship_to_city ?? '',
      shipToState: shipment.ship_to_state ?? '',
      shipToZip: shipment.ship_to_zip ?? '',
      shipToPhone: shipment.ship_to_phone ?? '',
      shippingMethodId: shipment.shipping_method_id ?? '',
      profileId: shipment.shipping_profile_id ?? '',
      weightLbs: shipment.weight_lbs != null ? String(shipment.weight_lbs) : '',
      dimL: shipment.length_in != null ? String(shipment.length_in) : '',
      dimW: shipment.width_in != null ? String(shipment.width_in) : '',
      dimH: shipment.height_in != null ? String(shipment.height_in) : '',
      deliveryNotes: linkedTask?.description ?? '',
      taskAssignedTo: linkedTask?.assigned_to ?? '',
    }

    return (
      <div className="p-8 max-w-3xl">
        {crumbs}
        <div className="mb-6 flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-qm-black">Shipment</h1>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHIP_STATUS_STYLES[shipment.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {SHIP_STATUS_LABELS[shipment.status] ?? shipment.status}
          </span>
          {soHref && <Link href={soHref} className="text-sm text-qm-fuchsia hover:underline">View SO →</Link>}
        </div>

        <ShipmentFormClient
          orgId={org.id}
          orgSlug={slug}
          shippingMethods={shippingMethods}
          shippingProfiles={shippingProfiles}
          teamMembers={teamMembers}
          initialError={sp.error ? decodeURIComponent(sp.error) : undefined}
          shipmentId={shipment.id}
          initial={initial}
        />
      </div>
    )
  }

  // ── Read-only view (anything past Pending, or no edit permission) ────────
  const cost = shipment.actual_cost != null
    ? `$${Number(shipment.actual_cost).toFixed(2)}`
    : shipment.quoted_rate != null ? `$${Number(shipment.quoted_rate).toFixed(2)} (quoted)` : '—'
  const methodLabel = shipment.shipping_methods?.name ?? shipment.carrier ?? '—'
  const hasAddress = shipment.ship_to_name || shipment.ship_to_street || shipment.ship_to_city || shipment.ship_to_state || shipment.ship_to_zip
  const dims = shipment.length_in != null && shipment.width_in != null && shipment.height_in != null
    ? `${shipment.length_in}×${shipment.width_in}×${shipment.height_in}"`
    : null
  const isLocalOrPickup = shipment.shipping_methods?.carrier === 'local' || shipment.shipping_methods?.carrier === 'pickup'
  const linkedTaskRO = isLocalOrPickup
    ? await dbOrThrow(
        service.from('tasks').select('description, assigned_profile:profiles!tasks_assigned_to_fkey(full_name)').eq('shipment_id', shipment.id).maybeSingle()
      ) as { description: string | null; assigned_profile: { full_name: string | null } | null } | null
    : null

  return (
    <div className="p-8 max-w-3xl">
      {crumbs}
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-extrabold text-qm-black">Shipment</h1>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${SHIP_STATUS_STYLES[shipment.status] ?? 'bg-gray-100 text-gray-600'}`}>
          {SHIP_STATUS_LABELS[shipment.status] ?? shipment.status}
        </span>
        {isPending && !canEdit && (
          <span className="text-xs italic text-gray-400">You don&apos;t have permission to edit this shipment.</span>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Linked to</p>
          <p className="text-sm font-medium text-gray-900">{linkedLabel}</p>
          {custLabel && shipment.sales_order_id && <p className="text-xs text-gray-500">{custLabel}</p>}
          {soHref && <Link href={soHref} className="mt-2 inline-block text-sm text-qm-fuchsia hover:underline">View Sales Order →</Link>}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Destination</p>
          {hasAddress ? (
            <div className="text-sm text-gray-700">
              {shipment.ship_to_name && <p className="font-medium text-gray-900">{shipment.ship_to_name}</p>}
              {shipment.ship_to_street && <p>{shipment.ship_to_street}</p>}
              <p>{[shipment.ship_to_city, shipment.ship_to_state, shipment.ship_to_zip].filter(Boolean).join(', ')}</p>
              {shipment.ship_to_phone && <p className="text-gray-500">{shipment.ship_to_phone}</p>}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">No destination on file.</p>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Package</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-gray-400">Method</dt><dd className="text-gray-900">{methodLabel}</dd></div>
            <div><dt className="text-gray-400">Weight</dt><dd className="text-gray-900">{shipment.weight_lbs != null ? `${shipment.weight_lbs} lbs` : '—'}</dd></div>
            <div><dt className="text-gray-400">Dimensions</dt><dd className="text-gray-900">{dims ?? '—'}</dd></div>
            <div><dt className="text-gray-400">Box Profile</dt><dd className="text-gray-900">{shipment.shipping_profiles?.name ?? '—'}</dd></div>
          </dl>
        </div>

        {isLocalOrPickup && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Delivery / Pickup</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-gray-400">Assigned To</dt><dd className="text-gray-900">{linkedTaskRO?.assigned_profile?.full_name ?? 'Unassigned'}</dd></div>
            </dl>
            {linkedTaskRO?.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{linkedTaskRO.description}</p>
            )}
          </div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Shipping</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt className="text-gray-400">Carrier</dt><dd className="text-gray-900">{shipment.carrier ?? '—'}</dd></div>
            <div><dt className="text-gray-400">Cost</dt><dd className="text-gray-900">{cost}</dd></div>
            <div><dt className="text-gray-400">Tracking Number</dt><dd className="font-mono text-gray-900">{shipment.tracking_number ?? '—'}</dd></div>
            <div><dt className="text-gray-400">Created</dt><dd className="text-gray-900">{formatShipDate(shipment.created_at)}</dd></div>
          </dl>
          {shipment.label_url && (
            <a href={shipment.label_url} target="_blank" rel="noopener noreferrer"
              className="mt-4 inline-block rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Print Label ↗
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
