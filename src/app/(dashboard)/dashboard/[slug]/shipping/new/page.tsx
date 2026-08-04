import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { checkPermission } from '@/lib/check-permission'
import { getCustomerShippingInfo } from '../actions'
import type { SoSearchRow } from '../../sales-orders/actions'
import { formatSoNumber } from '../../sales-orders/format'
import ShipmentFormClient, { type ShipmentFormInitial } from '../shipment-form-client'
import { dbOrThrow } from '@/lib/db'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ error?: string; so?: string }>
}

export default async function NewShipmentPage(props: PageProps) {
  try {
    return await NewShipmentPageInner(props)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[shipping-new] page crash:', err)
    return (
      <div style={{ padding: '2rem', color: '#b91c1c', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>PAGE ERROR (shipping-new)</h1>
        <div>{message}</div>
      </div>
    )
  }
}

async function NewShipmentPageInner({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const org = await dbOrThrow(
    supabase.from('organizations').select('id, name, slug').eq('slug', slug).maybeSingle()
  ) as OrgRow | null
  if (!org) notFound()

  const { allowed } = await checkPermission(org.id, 'shipping.create')
  if (!allowed) {
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900">New Shipment</h1>
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          You don&apos;t have permission to create shipments.
        </div>
      </div>
    )
  }

  type ShipMethodRow = { id: string; name: string; carrier: string | null; is_active: boolean }
  type ShipProfileRow = { id: string; name: string; length_in: number | null; width_in: number | null; height_in: number | null; max_weight_lbs: number | null; is_active: boolean }
  type TeamMemberRow = { id: string; full_name: string | null }

  // profiles RLS only allows selecting your own row (auth.uid() = id), so the
  // team-member picker needs the service client to see the whole org.
  const service = createServiceClient()
  const [mRes, pRes, tRes] = await Promise.all([
    supabase.from('shipping_methods').select('id, name, carrier, is_active').eq('organization_id', org.id).eq('is_active', true).order('name'),
    supabase.from('shipping_profiles').select('id, name, length_in, width_in, height_in, max_weight_lbs, is_active').eq('organization_id', org.id).eq('is_active', true).order('name'),
    service.from('profiles').select('id, full_name').eq('organization_id', org.id).order('full_name'),
  ])
  const shippingMethods = (mRes.data ?? []) as ShipMethodRow[]
  const shippingProfiles = (pRes.data ?? []) as ShipProfileRow[]
  const teamMembers = (tRes.data ?? []) as TeamMemberRow[]

  // When arriving from a Sales Order (e.g. its "+ Add Shipment" link), the SO
  // and its customer's address are pre-resolved server-side so the form opens
  // already linked, not blank with the SO left for the user to search for.
  let initial: ShipmentFormInitial | undefined
  let soHref: string | null = null
  if (sp.so) {
    const { data: soRow } = await supabase
      .from('sales_orders')
      .select('id, so_number, title, status, total, created_at, customer_id, customers(first_name, last_name, company_name), shipments(id)')
      .eq('id', sp.so)
      .eq('organization_id', org.id)
      .maybeSingle() as { data: SoSearchRow | null; error: unknown }

    if (soRow) {
      soHref = `/dashboard/${slug}/sales-orders/${soRow.id}`
      const resolvedCustomer = soRow.customer_id ? await getCustomerShippingInfo(org.id, soRow.customer_id) : null
      initial = {
        linkMode: 'so',
        selectedSo: soRow,
        resolvedCustomer,
        shipToName: resolvedCustomer ? (resolvedCustomer.company_name || resolvedCustomer.name) : '',
        shipToStreet: resolvedCustomer?.street ?? '',
        shipToCity: resolvedCustomer?.city ?? '',
        shipToState: resolvedCustomer?.state ?? '',
        shipToZip: resolvedCustomer?.zip ?? '',
        shipToPhone: resolvedCustomer?.phone ?? '',
        shippingMethodId: '',
        profileId: '',
        weightLbs: '',
        dimL: '',
        dimW: '',
        dimH: '',
        deliveryNotes: '',
        taskAssignedTo: '',
      }
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/shipping`} className="hover:text-gray-700">Shipping</Link>
        <span>/</span>
        <span className="text-gray-700">New</span>
      </div>

      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-extrabold text-qm-black">New Shipment</h1>
        {soHref && initial?.selectedSo && (
          <Link href={soHref} className="text-sm text-qm-fuchsia hover:underline">
            ← Back to {formatSoNumber(initial.selectedSo.so_number, initial.selectedSo.created_at)}
          </Link>
        )}
      </div>

      <ShipmentFormClient
        orgId={org.id}
        orgSlug={slug}
        shippingMethods={shippingMethods}
        shippingProfiles={shippingProfiles}
        teamMembers={teamMembers}
        initialError={sp.error ? decodeURIComponent(sp.error) : undefined}
        initial={initial}
      />
    </div>
  )
}
