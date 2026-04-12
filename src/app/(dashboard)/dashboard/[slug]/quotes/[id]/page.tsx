import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { QuoteStatus } from '@/types/database'
import QuoteDetailClient from './quote-detail-client'

type PageProps = { params: Promise<{ slug: string; id: string }> }

export default async function QuoteDetailPage({ params }: PageProps) {
  const { slug, id } = await params
  const supabase = await createClient()

  type OrgRow = { id: string; name: string; slug: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', slug)
    .maybeSingle() as { data: OrgRow | null; error: unknown }
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
    subtotal: number
    tax_total: number
    total: number
    customer_id: string | null
    converted_to_so_id: string | null
    customers: {
      first_name: string
      last_name: string
      company_name: string | null
      email: string | null
      phone: string | null
    } | null
  }

  const { data: quote } = await supabase
    .from('quotes')
    .select(`
      id, quote_number, title, description, status, created_at,
      expires_at, terms, notes, subtotal, tax_total, total,
      customer_id, converted_to_so_id,
      customers(first_name, last_name, company_name, email, phone)
    `)
    .eq('id', id)
    .eq('organization_id', org.id)
    .maybeSingle() as { data: QuoteRow | null; error: unknown }

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
  }

  const { data: lineItems } = await supabase
    .from('quote_line_items')
    .select('id, product_id, description, width, height, quantity, unit_price, discount_percent, total_price, taxable, sort_order')
    .eq('quote_id', id)
    .order('sort_order', { ascending: true }) as { data: LineItemRow[] | null; error: unknown }

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
  }

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

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/dashboard/${slug}`} className="hover:text-gray-700">{org.name}</Link>
        <span>/</span>
        <Link href={`/dashboard/${slug}/quotes`} className="hover:text-gray-700">Quotes</Link>
        <span>/</span>
        <span className="text-gray-700">Q-{String(quote.quote_number).padStart(4, '0')}</span>
      </div>

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
          subtotal: quote.subtotal,
          tax_total: quote.tax_total,
          total: quote.total,
          customer: quote.customers
            ? {
                first_name: quote.customers.first_name,
                last_name: quote.customers.last_name,
                company_name: quote.customers.company_name,
                email: quote.customers.email,
                phone: quote.customers.phone,
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
        }))}
        products={products ?? []}
        salesOrder={salesOrder}
      />
    </div>
  )
}
