import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import type { Product, ProductCategory } from '@/types/product-builder'
import ProductsListClient, { type ProductRow } from './products-list-client'

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

  // Fetch products with category join
  type ProductDbRow = Pick<
    Product,
    'id' | 'name' | 'part_number' | 'pricing_type' | 'price' | 'status' | 'active'
  > & {
    category: Pick<ProductCategory, 'name'> | null
  }

  const { data: productRows } = await supabase
    .from('products')
    .select('id, name, part_number, pricing_type, price, status, active, category:product_categories(name)')
    .eq('organization_id', org.id)
    .order('name', { ascending: true }) as { data: ProductDbRow[] | null; error: unknown }

  const products: ProductRow[] = (productRows ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    part_number: p.part_number,
    category_name: p.category?.name ?? null,
    pricing_type: p.pricing_type,
    price: p.price,
    status: p.status,
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
          <a
            href={`/dashboard/${slug}/products/new`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add New Product
          </a>
        </div>
      </div>

      {/* Client-side search/filter + table */}
      <ProductsListClient products={products} orgSlug={slug} />
    </div>
  )
}
