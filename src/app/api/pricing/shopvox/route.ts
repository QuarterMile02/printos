import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { userBelongsToOrg } from '@/lib/require-org-access'
import { calculateShopvoxReferencePrice, type ShopvoxReferencePriceInput } from '@/lib/pricing/shopvox-reference-price'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ShopvoxReferencePriceInput
    if (!body.product_id) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
    }

    const service = createServiceClient()
    const { data: productRow } = await service
      .from('products')
      .select('organization_id')
      .eq('id', body.product_id)
      .maybeSingle()
    const orgId = (productRow as { organization_id: string } | null)?.organization_id
    if (!orgId) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    // Had NO auth check at all -- full cost/sell breakdown for any
    // product_id, unauthenticated. Resolve org from the product row itself
    // (never trust a client-supplied org id) and require membership --
    // BEFORE doing the actual pricing computation below, not after, so an
    // unauthorized caller can't force the extra materials/labor_rates/
    // machine_rates/discount queries either.
    if (!(await userBelongsToOrg(orgId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await calculateShopvoxReferencePrice(body)
    const { organization_id: _organization_id, not_found: _not_found, ...publicResult } = result
    return NextResponse.json(publicResult)
  } catch (err) {
    console.error('[/api/pricing/shopvox] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
