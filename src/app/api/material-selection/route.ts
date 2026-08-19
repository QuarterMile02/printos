// POST /api/material-selection
// Live preview wrapper around the smart-material-engine. Used by the
// quote line-item builder to show "load roll X / route to printer Y /
// uses Z sqft" beside each line item before the quote is approved.
//
// Body: { product_id, org_id, width_inches, height_inches, quantity }
// The route resolves the product's banner-ness and allowed material
// categories, then calls the engine. No DB writes.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  selectMaterial,
  isBannerProduct,
  getProductMaterialCategories,
  type MaterialSelectionResult,
} from '@/lib/material-selection/smart-material-engine'

type Body = {
  product_id?: string
  org_id?: string
  width_inches?: number
  height_inches?: number
  quantity?: number
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body
    if (!body.product_id || !body.org_id) {
      return NextResponse.json({ error: 'product_id and org_id are required' }, { status: 400 })
    }

    const service = createServiceClient()

    type ProductRow = {
      name: string
      product_categories: { name: string } | null
    }
    const { data: productRaw } = await service
      .from('products')
      .select('name, product_categories(name)')
      .eq('id', body.product_id)
      .eq('organization_id', body.org_id)
      .maybeSingle() as { data: ProductRow | null; error: unknown }

    if (!productRaw) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const allowed_material_category_ids = await getProductMaterialCategories(service, body.product_id)

    const result: MaterialSelectionResult = await selectMaterial(service, {
      organization_id: body.org_id,
      width_inches: body.width_inches ?? 0,
      height_inches: body.height_inches ?? 0,
      quantity: body.quantity ?? 1,
      is_banner: isBannerProduct(productRaw.name, productRaw.product_categories?.name),
      allowed_material_category_ids,
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/material-selection] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
