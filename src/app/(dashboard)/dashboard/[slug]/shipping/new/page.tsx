import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { checkPermission } from '@/lib/check-permission'
import NewShipmentClient from './new-shipment-client'

type PageProps = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ error?: string }>
}

export default async function NewShipmentPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const sp = await searchParams
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
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

  const [mRes, pRes] = await Promise.all([
    supabase.from('shipping_methods').select('id, name, carrier, is_active').eq('organization_id', org.id).eq('is_active', true).order('name'),
    supabase.from('shipping_profiles').select('id, name, length_in, width_in, height_in, max_weight_lbs, is_active').eq('organization_id', org.id).eq('is_active', true).order('name'),
  ])
  const shippingMethods = (mRes.data ?? []) as ShipMethodRow[]
  const shippingProfiles = (pRes.data ?? []) as ShipProfileRow[]

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/shipping`} className="hover:text-gray-700">Shipping</Link>
        <span>/</span>
        <span className="text-gray-700">New</span>
      </div>

      <h1 className="mb-6 text-2xl font-extrabold text-qm-black">New Shipment</h1>

      <NewShipmentClient
        orgId={org.id}
        orgSlug={slug}
        shippingMethods={shippingMethods}
        shippingProfiles={shippingProfiles}
        initialError={sp.error ? decodeURIComponent(sp.error) : undefined}
      />
    </div>
  )
}
