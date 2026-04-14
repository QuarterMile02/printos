import { createServiceClient } from '@/lib/supabase/server'

// ── Types ────────────────────────────────────────────────────────────

export type PricingInput = {
  product_id: string
  width_inches: number
  height_inches: number
  quantity: number
  selected_modifiers?: Record<string, boolean | number> // modifier_id → value
  selected_dropdown_items?: Record<string, string>       // menu_id → dropdown_item_id
}

export type LineBreakdown = {
  name: string
  item_type: string
  formula: string
  cost_cents: number
  price_cents: number
  in_base: boolean
}

export type PricingResult = {
  unit_price_cents: number
  total_price_cents: number
  breakdown: LineBreakdown[]
  original_unit_price_cents?: number
  discount_percent?: number
  discount_type?: string
  error?: string
}

// ── Formula helpers ──────────────────────────────────────────────────

function formulaMultiplier(
  formula: string | null,
  widthIn: number,
  heightIn: number,
  qty: number,
): number {
  switch (formula) {
    case 'Area':      return (widthIn * heightIn) / 144 // sq ft
    case 'Perimeter': return (2 * (widthIn + heightIn)) / 12 // linear ft
    case 'Width':     return widthIn / 12 // linear ft
    case 'Height':    return heightIn / 12 // linear ft
    case 'Unit':      return 1
    case 'Fixed Qty': return 1
    default:          return 1
  }
}

// ── Main engine ──────────────────────────────────────────────────────

export async function calculateProductPrice(input: PricingInput): Promise<PricingResult> {
  const service = createServiceClient()

  // 1. Load product
  const { data: prodRow, error: prodErr } = await service
    .from('products')
    .select('id, cost, price, markup, formula, pricing_type, volume_discount_id, range_discount_id')
    .eq('id', input.product_id)
    .single()

  if (prodErr || !prodRow) {
    return { unit_price_cents: 0, total_price_cents: 0, breakdown: [], error: prodErr?.message ?? 'Product not found' }
  }
  const product = prodRow as { id: string; cost: number | null; price: number | null; markup: number | null; formula: string | null; pricing_type: string | null; volume_discount_id: string | null; range_discount_id: string | null }

  // 2. Load recipe (product_default_items)
  const { data: recipeRows } = await service
    .from('product_default_items')
    .select('id, item_type, material_id, labor_rate_id, machine_rate_id, custom_item_name, custom_item_cost, custom_item_price, system_formula, multiplier, include_in_base_price, charge_per_li_unit, fixed_quantity, percentage_of_base')
    .eq('product_id', input.product_id)
    .order('sort_order')

  const recipeItems = (recipeRows ?? []) as {
    id: string; item_type: string
    material_id: string | null; labor_rate_id: string | null; machine_rate_id: string | null
    custom_item_name: string | null; custom_item_cost: number | null; custom_item_price: number | null
    system_formula: string | null; multiplier: number | null
    include_in_base_price: boolean | null; charge_per_li_unit: boolean | null
    fixed_quantity: number | null; percentage_of_base: number | null
  }[]

  // 3. Load rate costs
  const matIds = recipeItems.filter(r => r.material_id).map(r => r.material_id!)
  const laborIds = recipeItems.filter(r => r.labor_rate_id).map(r => r.labor_rate_id!)
  const machineIds = recipeItems.filter(r => r.machine_rate_id).map(r => r.machine_rate_id!)

  const rateMap = new Map<string, { name: string; cost: number; price: number; production_rate: number | null; units: string | null }>()

  if (matIds.length > 0) {
    const { data, error: matErr } = await service.from('materials').select('id, name, cost, price, selling_units').in('id', matIds)
    console.log('[pricing] materials loaded:', data?.length, 'error:', matErr?.message)
    for (const r of (data ?? []) as { id: string; name: string; cost: number | null; price: number | null; selling_units: string | null }[])
      rateMap.set(r.id, { name: r.name, cost: Number(r.cost ?? 0), price: Number(r.price ?? 0), production_rate: null, units: r.selling_units })
  }
  if (laborIds.length > 0) {
    const { data, error: laborErr } = await service.from('labor_rates').select('id, name, cost, price, production_rate, units').in('id', laborIds)
    console.log('[pricing] labor_rates loaded:', data?.length, 'error:', laborErr?.message)
    for (const r of (data ?? []) as { id: string; name: string; cost: number | null; price: number | null; production_rate: number | null; units: string | null }[]) {
      console.log('[pricing] labor:', r.name, 'cost:', r.cost, 'prod_rate:', r.production_rate, 'units:', r.units)
      rateMap.set(r.id, { name: r.name, cost: Number(r.cost ?? 0), price: Number(r.price ?? 0), production_rate: r.production_rate ? Number(r.production_rate) : null, units: r.units })
    }
  }
  if (machineIds.length > 0) {
    const { data, error: machErr } = await service.from('machine_rates').select('id, name, cost, price, production_rate, units').in('id', machineIds)
    console.log('[pricing] machine_rates loaded:', data?.length, 'error:', machErr?.message)
    for (const r of (data ?? []) as { id: string; name: string; cost: number | null; price: number | null; production_rate: number | null; units: string | null }[])
      rateMap.set(r.id, { name: r.name, cost: Number(r.cost ?? 0), price: Number(r.price ?? 0), production_rate: r.production_rate ? Number(r.production_rate) : null, units: r.units })
  }

  // 4. Load product modifiers + modifier definitions
  const { data: pmRows } = await service
    .from('product_modifiers')
    .select('modifier_id')
    .eq('product_id', input.product_id)
  const modifierIds = ((pmRows ?? []) as { modifier_id: string | null }[])
    .map(r => r.modifier_id).filter(Boolean) as string[]

  const modifierMap = new Map<string, { name: string; modifier_type: string }>()
  if (modifierIds.length > 0) {
    const { data } = await service.from('modifiers').select('id, display_name, modifier_type').in('id', modifierIds)
    for (const m of (data ?? []) as { id: string; display_name: string; modifier_type: string }[])
      modifierMap.set(m.id, { name: m.display_name, modifier_type: m.modifier_type })
  }

  // 5. Calculate each recipe item
  const breakdown: LineBreakdown[] = []
  let basePriceCents = 0
  let totalCostCents = 0

  for (const item of recipeItems) {
    const refId = item.material_id ?? item.labor_rate_id ?? item.machine_rate_id
    let rateCost = 0
    let ratePrice = 0
    let name = item.custom_item_name ?? 'Custom'

    let productionRate: number | null = null
    let rateUnits: string | null = null

    if (refId && rateMap.has(refId)) {
      const r = rateMap.get(refId)!
      rateCost = r.cost
      ratePrice = r.price
      name = r.name
      productionRate = r.production_rate
      rateUnits = r.units
    } else if (item.item_type === 'CustomItem') {
      rateCost = Number(item.custom_item_cost ?? 0)
      ratePrice = Number(item.custom_item_price ?? 0)
    }

    const formula = item.system_formula ?? product.formula ?? 'Area'
    const mult = Number(item.multiplier ?? 1)
    const fMult = formulaMultiplier(formula, input.width_inches, input.height_inches, input.quantity)

    // percentage_of_base items are handled after base is summed
    if (item.percentage_of_base && Number(item.percentage_of_base) > 0) {
      breakdown.push({
        name,
        item_type: item.item_type,
        formula: `PBase ${Number(item.percentage_of_base)}%`,
        cost_cents: 0,
        price_cents: 0,
        in_base: false,
      })
      continue
    }

    // For hourly labor/machine rates with a production_rate:
    // time_hours = formula_units / production_rate
    // cost = time_hours * hourly_cost
    // Without production_rate: treat cost as per-formula-unit directly
    let itemCost: number
    let itemPrice: number

    if (rateUnits === 'Hr' && productionRate && productionRate > 0 && formula !== 'Unit') {
      const timeHours = fMult / productionRate
      itemCost = rateCost * timeHours * mult
      itemPrice = ratePrice * timeHours * mult
      console.log('[pricing] hourly calc:', name, 'fMult:', fMult, 'prodRate:', productionRate, 'timeHrs:', timeHours, 'cost:', itemCost)
    } else {
      itemCost = rateCost * fMult * mult
      itemPrice = ratePrice * fMult * mult
      console.log('[pricing] direct calc:', name, 'rateCost:', rateCost, 'fMult:', fMult, 'mult:', mult, 'cost:', itemCost)
    }

    if (item.fixed_quantity && Number(item.fixed_quantity) > 0) {
      itemCost = rateCost * Number(item.fixed_quantity) * mult
      itemPrice = ratePrice * Number(item.fixed_quantity) * mult
    }

    if (item.charge_per_li_unit) {
      itemCost *= input.quantity
      itemPrice *= input.quantity
    }

    const costCents = Math.round(itemCost * 100)
    const priceCents = Math.round(itemPrice * 100)

    breakdown.push({
      name,
      item_type: item.item_type,
      formula,
      cost_cents: costCents,
      price_cents: priceCents,
      in_base: item.include_in_base_price ?? false,
    })

    totalCostCents += costCents
    if (item.include_in_base_price) {
      basePriceCents += priceCents
    }
  }

  // 6. Apply percentage-of-base items
  for (let i = 0; i < recipeItems.length; i++) {
    const item = recipeItems[i]
    if (!item.percentage_of_base || Number(item.percentage_of_base) <= 0) continue
    const pct = Number(item.percentage_of_base) / 100
    const pbaseCost = Math.round(basePriceCents * pct)
    // Find this item in breakdown and fill costs
    const bItem = breakdown.find(b => b.formula.startsWith('PBase'))
    if (bItem && bItem.cost_cents === 0) {
      bItem.cost_cents = pbaseCost
      bItem.price_cents = pbaseCost
      totalCostCents += pbaseCost
    }
  }

  // 7. Apply modifier charges
  const selectedMods = input.selected_modifiers ?? {}
  for (const [modId, value] of Object.entries(selectedMods)) {
    const mod = modifierMap.get(modId)
    if (!mod) continue

    if (mod.modifier_type === 'Boolean' && value === true) {
      // Boolean modifiers typically add a percentage of base
      // For now treat as a flat addition — extend later
      breakdown.push({
        name: mod.name,
        item_type: 'Modifier',
        formula: 'Boolean',
        cost_cents: 0,
        price_cents: 0,
        in_base: false,
      })
    } else if (mod.modifier_type === 'Numeric' && typeof value === 'number') {
      const addCents = Math.round(value * 100)
      breakdown.push({
        name: mod.name,
        item_type: 'Modifier',
        formula: 'Numeric',
        cost_cents: addCents,
        price_cents: addCents,
        in_base: false,
      })
      totalCostCents += addCents
    }
  }

  // 8. Apply markup (default to 1 if 0 or null — 0 markup makes no business sense)
  const markup = Number(product.markup) > 0 ? Number(product.markup) : 1
  console.log('[pricing] totalCostCents:', totalCostCents, 'markup:', markup, '(raw:', product.markup, ') recipe items:', recipeItems.length, 'rateMap size:', rateMap.size)
  let unitPriceCents = Math.round(totalCostCents * markup)
  const originalUnitPriceCents = unitPriceCents

  // 9. Apply discounts (volume first, then range)
  let discountPercent = 0
  let discountType: string | undefined

  // Volume discount — based on quantity
  if (product.volume_discount_id) {
    const tier = await findDiscountTier(service, product.volume_discount_id, input.quantity)
    if (tier && tier.discount_percent > 0) {
      discountPercent = tier.discount_percent
      discountType = 'Volume'
    }
  }

  // Range discount — based on area (sqft)
  if (!discountPercent && product.range_discount_id) {
    const area = (input.width_inches * input.height_inches) / 144
    const tier = await findDiscountTier(service, product.range_discount_id, area)
    if (tier && tier.discount_percent > 0) {
      discountPercent = tier.discount_percent
      discountType = 'Range'
    }
  }

  if (discountPercent > 0) {
    unitPriceCents = Math.round(unitPriceCents * (1 - discountPercent / 100))
  }

  const totalPriceCents = unitPriceCents * input.quantity

  return {
    unit_price_cents: unitPriceCents,
    total_price_cents: totalPriceCents,
    breakdown,
    // Always return discount fields so callers can confirm the code path ran
    original_unit_price_cents: originalUnitPriceCents,
    discount_percent: discountPercent,
    discount_type: discountType ?? (product.volume_discount_id || product.range_discount_id ? 'none_matched' : 'no_discount_assigned'),
  }
}

// ── Discount tier lookup ─────────────────────────────────────────────

async function findDiscountTier(
  service: ReturnType<typeof createServiceClient>,
  discountId: string,
  value: number,
): Promise<{ discount_percent: number } | null> {
  const { data: tiers } = await service
    .from('discount_tiers')
    .select('min_qty, max_qty, discount_percent')
    .eq('discount_id', discountId)
    .order('min_qty', { ascending: true })

  for (const tier of (tiers ?? []) as { min_qty: number; max_qty: number; discount_percent: number }[]) {
    const min = Number(tier.min_qty)
    const max = Number(tier.max_qty)
    if (value >= min && value <= max) {
      return { discount_percent: Number(tier.discount_percent) }
    }
  }
  return null
}
