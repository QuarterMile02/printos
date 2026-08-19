import { NextRequest, NextResponse } from 'next/server'
import { calculateProductPrice, type PricingInput } from '@/lib/pricing/formula-engine'
import { createServiceClient } from '@/lib/supabase/server'
import { userBelongsToOrg } from '@/lib/require-org-access'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PricingInput

    if (!body.product_id) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
    }

    // No org id in the body at all -- this route had NO auth check and
    // returned full cost/price breakdowns (real margins) for any product_id
    // to anyone. product_id doesn't carry its org with it, so resolve the
    // product's real org server-side first, then require membership.
    const service = createServiceClient()
    const { data: productRow } = await service
      .from('products')
      .select('organization_id')
      .eq('id', body.product_id)
      .maybeSingle()
    const productOrgId = (productRow as { organization_id: string } | null)?.organization_id
    if (!productOrgId) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }
    if (!(await userBelongsToOrg(productOrgId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await calculateProductPrice({
      product_id: body.product_id,
      width_inches: body.width_inches ?? 0,
      height_inches: body.height_inches ?? 0,
      quantity: body.quantity ?? 1,
      selected_modifiers: body.selected_modifiers ?? {},
      selected_dropdown_items: body.selected_dropdown_items ?? {},
    })

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/pricing] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
