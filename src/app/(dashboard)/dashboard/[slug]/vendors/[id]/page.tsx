import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import VendorDetailClient from './vendor-detail-client'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function VendorDetailPage({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations').select('id, name, slug').eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
  if (!org) notFound()

  type VendorRow = {
    id: string; name: string; legal_name: string | null
    primary_contact: string | null; primary_email: string | null; primary_phone: string | null
    street: string | null; city: string | null; state: string | null
    zip: string | null; country: string | null
    secondary_street: string | null; secondary_city: string | null
    secondary_state: string | null; secondary_zip: string | null
    website: string | null; catalog_url: string | null
    account_id: string | null; tax_id: string | null; tax: string | null
    terms: string | null; payment_method: string | null
    categories: string | null; hours_of_operation: string | null
    background_info: string | null; is_active: boolean | null; created_at: string
  }
  const { data: vendor } = await supabase
    .from('vendors')
    .select(`id, name, legal_name, primary_contact, primary_email, primary_phone,
      street, city, state, zip, country,
      secondary_street, secondary_city, secondary_state, secondary_zip,
      website, catalog_url, account_id, tax_id, tax, terms, payment_method,
      categories, hours_of_operation, background_info, is_active, created_at`)
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: VendorRow | null; error: unknown }
  if (!vendor) notFound()

  type MaterialVendorRow = {
    material_id: string
    vendor_price: number
    part_number: string | null
    materials: { id: string; name: string; buying_units: string | null } | null
  }
  const { data: materialVendorRows } = await supabase
    .from('material_vendors')
    .select('material_id, vendor_price, part_number, materials(id, name, buying_units)')
    .eq('organization_id', org.id)
    .eq('vendor_name', vendor.name)
    .eq('active', true)
    .order('vendor_price', { ascending: true }) as { data: MaterialVendorRow[] | null; error: unknown }

  const materials = materialVendorRows ?? []

  return (
    <div className="p-8 max-w-4xl">
      {/* Breadcrumbs */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <a href={`/dashboard/${slug}/vendors`} className="hover:text-gray-700">Vendors</a>
          <span>/</span>
          <span className="text-gray-700">{vendor.name}</span>
        </div>
        <a
          href={`/dashboard/${slug}/vendors`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-qm-gray hover:text-qm-black transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Vendors
        </a>
      </div>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-extrabold text-qm-black">{vendor.name}</h1>
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            vendor.is_active !== false ? 'bg-qm-lime-light text-qm-lime-dark' : 'bg-gray-100 text-gray-600'
          }`}>
            {vendor.is_active !== false ? 'Active' : 'Inactive'}
          </span>
        </div>
        {vendor.legal_name && <p className="text-sm text-qm-gray mt-0.5">{vendor.legal_name}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-qm-gray">
          {vendor.primary_email && (
            <a href={`mailto:${vendor.primary_email}`} className="flex items-center gap-1.5 hover:text-qm-lime">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              {vendor.primary_email}
            </a>
          )}
          {vendor.primary_phone && (
            <a href={`tel:${vendor.primary_phone}`} className="flex items-center gap-1.5 hover:text-qm-lime">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
              </svg>
              {vendor.primary_phone}
            </a>
          )}
          {vendor.primary_contact && (
            <span className="flex items-center gap-1.5">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
              {vendor.primary_contact}
            </span>
          )}
        </div>
      </div>

      {/* Editable cards */}
      <VendorDetailClient
        vendorId={vendor.id}
        orgId={org.id}
        orgSlug={slug}
        initialData={{
          name: vendor.name,
          legal_name: vendor.legal_name,
          primary_contact: vendor.primary_contact,
          primary_email: vendor.primary_email,
          primary_phone: vendor.primary_phone,
          website: vendor.website,
          catalog_url: vendor.catalog_url,
          account_id: vendor.account_id,
          tax_id: vendor.tax_id,
          tax: vendor.tax,
          terms: vendor.terms,
          payment_method: vendor.payment_method,
          categories: vendor.categories,
          hours_of_operation: vendor.hours_of_operation,
          background_info: vendor.background_info,
          is_active: vendor.is_active,
          street: vendor.street,
          city: vendor.city,
          state: vendor.state,
          zip: vendor.zip,
          country: vendor.country,
          secondary_street: vendor.secondary_street,
          secondary_city: vendor.secondary_city,
          secondary_state: vendor.secondary_state,
          secondary_zip: vendor.secondary_zip,
        }}
      />

      {/* Linked Materials */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-bold text-qm-black">Linked Materials</h2>
          <span className="text-xs font-medium text-qm-gray">{materials.length}</span>
        </div>
        {materials.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-qm-gray">No materials linked to this vendor</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {materials.map((mv) => (
              <div key={mv.material_id} className="flex items-center justify-between px-6 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-qm-black">{mv.materials?.name ?? mv.material_id}</p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {mv.materials?.buying_units && (
                      <span className="text-xs text-qm-gray">{mv.materials.buying_units}</span>
                    )}
                    {mv.part_number && (
                      <span className="text-xs text-qm-gray">Part #{mv.part_number}</span>
                    )}
                  </div>
                </div>
                <p className="ml-4 shrink-0 text-sm font-semibold text-qm-black">
                  ${Number(mv.vendor_price).toFixed(4)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
