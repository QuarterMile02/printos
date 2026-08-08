import type { createServiceClient } from '@/lib/supabase/server'

type ServiceClient = ReturnType<typeof createServiceClient>

export async function resolveJobDepartments(
  quoteId: string,
  orgId: string,
  service: ServiceClient,
  // Scopes step 1 to one line item (migration 121's job-per-line-item
  // grain: each job now wants its own line item's department, not the
  // whole quote's aggregate). Omit to keep the old whole-quote behavior --
  // no live caller needs that anymore (convert-action.ts always passes
  // one now), kept optional only so this isn't a breaking signature change
  // for any future caller that legitimately wants the SO-wide aggregate
  // (e.g. a future "Order Board" summary).
  lineItemId?: string,
): Promise<string[]> {
  // Step 1 — line items with a product
  let liQuery = service
    .from('quote_line_items')
    .select('product_id')
    .eq('quote_id', quoteId)
    .not('product_id', 'is', null)
  if (lineItemId) liQuery = liQuery.eq('id', lineItemId)
  const { data: liRows, error: liErr } = await liQuery

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
