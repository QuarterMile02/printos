import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

function ProductSummary({ data, name }: { data: Record<string, unknown>; name: string }) {
  const s = (key: string) => String(data[key] ?? '—')
  const n = (key: string, fallback = 0) => Number(data[key] ?? fallback)
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-extrabold text-gray-900">{name}</h1>
      {data.description ? <p className="mt-1 text-sm text-gray-600">{s('description')}</p> : null}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Pricing Type</span>
          <p className="mt-0.5 text-gray-900">{s('pricing_type')}</p>
        </div>
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Formula</span>
          <p className="mt-0.5 text-gray-900">{s('formula')}</p>
        </div>
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Cost</span>
          <p className="mt-0.5 text-gray-900">${n('cost').toFixed(2)}</p>
        </div>
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Markup</span>
          <p className="mt-0.5 text-gray-900">{n('markup', 1).toFixed(2)}x</p>
        </div>
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Price</span>
          <p className="mt-0.5 text-gray-900">${n('price').toFixed(2)}</p>
        </div>
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Status</span>
          <p className="mt-0.5 text-gray-900 capitalize">{s('status')}</p>
        </div>
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Taxable</span>
          <p className="mt-0.5 text-gray-900">{data.taxable ? 'Yes' : 'No'}</p>
        </div>
        <div>
          <span className="block text-xs font-bold uppercase tracking-wider text-gray-500">Active</span>
          <p className="mt-0.5 text-gray-900">{data.active ? 'Yes' : 'No'}</p>
        </div>
      </div>
    </div>
  )
}

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function EditProductPage({ params }: PageProps) {
  const { slug, id } = await params

  let orgName = ''
  let productName = ''
  let productData: Record<string, unknown> | null = null
  let errorMsg: string | null = null

  try {
    const supabase = await createClient()

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('id, name, slug')
      .eq('slug', slug)
      .maybeSingle()

    if (orgErr || !org) {
      errorMsg = `Org lookup failed: ${orgErr?.message ?? 'not found for slug ' + slug}`
    } else {
      orgName = (org as Record<string, unknown>).name as string
      const orgId = (org as Record<string, unknown>).id as string

      const { data: product, error: prodErr } = await supabase
        .from('products')
        .select('id, name, description, pricing_type, formula, price, status, taxable, active, category_id, markup, cost')
        .eq('id', id)
        .eq('organization_id', orgId)
        .maybeSingle()

      if (prodErr || !product) {
        errorMsg = `Product lookup failed: ${prodErr?.message ?? 'not found for id ' + id}`
      } else {
        productData = product as Record<string, unknown>
        productName = (productData.name as string) ?? ''
      }
    }
  } catch (err) {
    errorMsg = `Unexpected error: ${err instanceof Error ? err.message : String(err)}`
  }

  if (errorMsg || !productData) {
    return (
      <div className="p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-sm">
          <h1 className="text-lg font-bold text-red-800">Product Detail Error</h1>
          <p className="mt-2"><strong>slug:</strong> {slug}</p>
          <p><strong>id:</strong> {id}</p>
          <p className="mt-2 text-red-700">{errorMsg}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{orgName}</Link>
          <span>/</span>
          <Link href={`/dashboard/${slug}/products`} className="hover:text-gray-700">Products</Link>
          <span>/</span>
          <span className="text-gray-700">{productName}</span>
        </div>
      </div>

      <ProductSummary data={productData} name={productName} />
    </div>
  )
}
