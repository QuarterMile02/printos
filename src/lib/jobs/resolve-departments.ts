import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

export async function resolveJobDepartments(
  quoteId: string,
  orgId: string,
  service: ServiceClient
): Promise<string[]> {
  // Step 1 — line items with a product
  const { data: liRows, error: liErr } = await service
    .from('quote_line_items')
    .select('product_id')
    .eq('quote_id', quoteId)
    .not('product_id', 'is', null)

  if (liErr || !liRows?.length) return []

  const productIds = [...new Set(liRows.map((r) => r.product_id as string))]

  // Step 2 — category_ids from products
  const { data: productRows, error: prodErr } = await service
    .from('products')
    .select('category_id')
    .in('id', productIds)

  if (prodErr || !productRows?.length) return []

  const categoryIds = [...new Set(
    (productRows.map((r) => r.category_id as string | null)).filter(Boolean) as string[]
  )]
  if (!categoryIds.length) return []

  // Step 3 — primary_department from product_categories
  const { data: catRows, error: catErr } = await service
    .from('product_categories')
    .select('primary_department')
    .in('id', categoryIds)
    .eq('organization_id', orgId)

  if (catErr || !catRows?.length) return []

  return [...new Set(
    (catRows.map((r) => r.primary_department as string | null)).filter(Boolean) as string[]
  )]
}
