import { NextRequest, NextResponse } from 'next/server'
import { calculateProductPrice, type PricingInput } from '@/lib/pricing/formula-engine'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PricingInput

    if (!body.product_id) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
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
