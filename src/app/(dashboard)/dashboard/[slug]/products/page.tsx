import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Product, ProductCategory } from '@/types/product-builder'
import ProductsListClient, { type ProductRow } from './products-list-client'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ slug: string }> }

export default async function ProductsPage({ params }: PageProps) {
  const { slug } = await params
  const supabase = await createClient()

  // Fetch org — RLS ensures user is a member
  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }

  if (!org) notFound()

  // Fetch products — try with category join, fall back without
  type ProductDbRow = {
    id: string
    name: string
    part_number: string | null
    pricing_type: string | null
    price: number | null
    status: string | null
    active: boolean | null
    category?: { name: string } | null
  }

  let productRows: ProductDbRow[] = []
  const { data: withCat, error: catErr } = await supabase
    .from('products')
    .select('id, name, part_number, pricing_type, price, status, active, category:product_categories(name)')
    .eq('organization_id', org.id)
    .order('name', { ascending: true })

  if (withCat && !catErr) {
    productRows = withCat as unknown as ProductDbRow[]
  } else {
    // category join failed — fetch without it
    const { data: noCat } = await supabase
      .from('products')
      .select('id, name, part_number, pricing_type, price, status, active')
      .eq('organization_id', org.id)
      .order('name', { ascending: true })
    productRows = (noCat ?? []) as unknown as ProductDbRow[]
  }

  const products: ProductRow[] = productRows.map((p) => ({
    id: p.id,
    name: p.name,
    part_number: p.part_number,
    category_name: p.category?.name ?? null,
    pricing_type: (p.pricing_type as ProductRow['pricing_type']) ?? null,
    price: p.price != null ? Number(p.price) : null,
    status: (p.status as ProductRow['status']) ?? null,
    active: p.active,
  }))

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <a href="/dashboard" className="hover:text-gray-700">Dashboard</a>
          <span>/</span>
          <a href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</a>
          <span>/</span>
          <span className="text-gray-700">Products</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-extrabold text-qm-black">Products</h1>
            <span className="inline-flex items-center rounded-full bg-qm-lime-light px-2.5 py-0.5 text-xs font-semibold text-qm-lime-dark">
              {products.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/${slug}/products/import`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-qm-black hover:bg-gray-50 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Import CSV
            </Link>
            <Link
              href={`/dashboard/${slug}/products/new`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add New Product
            </Link>
          </div>
        </div>
      </div>

      {/* Client-side search/filter + table */}
      <ProductsListClient products={products} orgSlug={slug} />
    </div>
  )
}
