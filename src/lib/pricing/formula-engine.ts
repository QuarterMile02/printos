import { createServiceClient } from '@/lib/supabase/server'
import { computeLineItem } from './compute-line-item'
import { dbAllOrThrow } from '@/lib/db'

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
  inactive?: boolean
  inactive_reason?: string
  // For modifier-direct rows or option-rate rows gated by a modifier_formula,
  // the modifier this row is attributable to. Lets the client surface a
  // per-modifier price hint without re-running the engine.
  modifier_id?: string
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
    // Area
    case 'Area':                              return (widthIn * heightIn) / 144                     // sq ft
    case 'Total_Area':                        return (widthIn * heightIn) / 144                     // sq ft (user-entered totals come pre-multiplied via width)
    case 'Area_in_sqyd':                      return (widthIn / 36) * (heightIn / 36)               // sq yd
    // Perimeter
    case 'Perimeter':                         return (2 * (widthIn + heightIn)) / 12                // linear ft
    case 'Perimeter_in_yards':                return (2 * (widthIn + heightIn)) / 36                // yards
    // Single-dimension
    case 'Width':                             return widthIn / 12                                   // linear ft
    case 'Width_in_yards':                    return widthIn / 36                                   // yards
    case 'Height':                            return heightIn / 12                                  // linear ft
    case 'Height_in_yards':                   return heightIn / 36                                  // yards
    case 'Length_in_yards':                   return widthIn / 36                                   // yards (length captured in width input)
    // Volume / board feet — depth/thickness not captured in this engine; treat thickness=1 inch
    case 'Volume':                            return widthIn * heightIn                             // cu in (depth=1)
    case 'Board_Feet':                        return (widthIn * heightIn) / 144                     // bd ft (thickness=1)
    // Cylindrical — treat width as radius, height as height
    case 'Cylindrical_Surface_Area':          return 2 * Math.PI * (widthIn / 2) * heightIn         // sq in
    case 'Cylindrical_Surface_Area_in_sqyd':  return (2 * Math.PI * (widthIn / 2) * heightIn) / 1296 // sq yd
    // Per-each
    case 'Unit':                              return 1
    case 'Fixed Qty':                         return 1
    default:                                  return 1
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

  const rateMap = new Map<string, { name: string; cost: number; price: number; production_rate: number | null; units: string | null; setup_charge: number | null; other_charge: number | null; variant_id?: string; variant_selection?: string }>()

  // material_id -> quantity-break tiers, sorted ascending by from_qty
  const materialTierMap = new Map<string, { from_qty: number; to_qty: number | null; cost: number; price: number }[]>()

  if (matIds.length > 0) {
    const { data, error: matErr } = await service.from('materials').select('id, name, cost, price, selling_units').in('id', matIds)
    console.log('[pricing] materials loaded:', data?.length, 'error:', matErr?.message)

    // Stage A: prefer a material_variants row over the flat materials.cost/price
    // when one can be selected with confidence. See
    // known-issues/2026-08-24-stageA-variant-pricing-investigation.md question 3
    // for the selection rule. Every live recipe material still has zero
    // variants as of this writing, so this branch is currently unreachable in
    // production -- it is correctness-readiness for when recipes get
    // repointed at variant-having materials, not a live price change.
    // PostgREST silently truncates any unbounded select at 1000 rows -- a
    // single material (e.g. "Vinyl Intermediate 2.5Mil Oracal 651") already
    // has 52 live variants, and a recipe spanning a few dozen variant-having
    // families would blow past 1000 rows with no error, silently dropping
    // the tail. Page through explicitly rather than trust a single select.
    const variantRows = await dbAllOrThrow<SelectableVariant>((from, to) =>
      service
        .from('material_variants')
        .select('id, material_id, width, height, fixed_side, is_default, cost_per_unit, sell_per_unit, sort_order')
        .in('material_id', matIds)
        .range(from, to)
    )
    const variantsByMaterial = new Map<string, SelectableVariant[]>()
    for (const v of variantRows) {
      const arr = variantsByMaterial.get(v.material_id) ?? []
      arr.push(v)
      variantsByMaterial.set(v.material_id, arr)
    }

    for (const r of (data ?? []) as { id: string; name: string; cost: number | null; price: number | null; selling_units: string | null }[]) {
      const picked = selectMaterialVariant(variantsByMaterial.get(r.id) ?? [], input.width_inches)
      // A selected variant with a null or non-positive cost_per_unit must NOT
      // silently become a free (or discrepant) material -- COALESCE-to-zero
      // here is the same class of bug we already ruled out for a missing
      // multiplier: never invent a number, fail safe instead. Zero is
      // disqualifying, not just null -- a $0 cost_per_unit is exactly as
      // wrong as a missing one (a material genuinely costing nothing to
      // stock isn't a real state this schema represents).
      //
      // sell_per_unit gets the identical guard, deliberately, not just for
      // symmetry: it isn't purely cosmetic -- computeLineItem's `price`
      // feeds basePriceCents for any item marked include_in_base_price,
      // which in turn sizes percentage_of_base line items (formula-engine.ts
      // step 6 below). A null/zero sell_per_unit would silently zero out
      // that base contribution the same way a bad cost_per_unit zeros out
      // the charged cost. It also keeps (cost, price) coming from one
      // source per material -- either both from the picked variant, or both
      // from materials.cost/price -- never a trusted variant cost paired
      // with an untrusted flat price or vice versa.
      const variantUsable = picked
        && picked.cost_per_unit != null && Number(picked.cost_per_unit) > 0
        && picked.sell_per_unit != null && Number(picked.sell_per_unit) > 0

      if (variantUsable) {
        rateMap.set(r.id, {
          name: r.name,
          cost: Number(picked.cost_per_unit),
          price: Number(picked.sell_per_unit),
          production_rate: null, units: r.selling_units, setup_charge: null, other_charge: null,
          variant_id: picked.id, variant_selection: picked._reason,
        })
      } else {
        if (picked) {
          console.warn(`[pricing] variant ${picked.id} selected for material ${r.id} ("${r.name}") but cost_per_unit/sell_per_unit is null or non-positive -- falling back to materials.cost/price`)
        }
        rateMap.set(r.id, { name: r.name, cost: Number(r.cost ?? 0), price: Number(r.price ?? 0), production_rate: null, units: r.selling_units, setup_charge: null, other_charge: null })
      }
    }

    const { data: tierRows } = await service
      .from('material_pricing_tiers')
      .select('material_id, from_qty, to_qty, cost, price')
      .in('material_id', matIds)
      .order('from_qty', { ascending: true })
    for (const t of (tierRows ?? []) as { material_id: string; from_qty: number; to_qty: number | null; cost: number; price: number }[]) {
      const arr = materialTierMap.get(t.material_id) ?? []
      arr.push({ from_qty: Number(t.from_qty), to_qty: t.to_qty == null ? null : Number(t.to_qty), cost: Number(t.cost), price: Number(t.price) })
      materialTierMap.set(t.material_id, arr)
    }
  }
  if (laborIds.length > 0) {
    const { data, error: laborErr } = await service.from('labor_rates').select('id, name, cost, price, production_rate, units, setup_charge, other_charge').in('id', laborIds)
    console.log('[pricing] labor_rates loaded:', data?.length, 'error:', laborErr?.message)
    for (const r of (data ?? []) as { id: string; name: string; cost: number | null; price: number | null; production_rate: number | null; units: string | null; setup_charge: number | null; other_charge: number | null }[]) {
      console.log('[pricing] labor:', r.name, 'cost:', r.cost, 'prod_rate:', r.production_rate, 'units:', r.units)
      rateMap.set(r.id, { name: r.name, cost: Number(r.cost ?? 0), price: Number(r.price ?? 0), production_rate: r.production_rate ? Number(r.production_rate) : null, units: r.units, setup_charge: r.setup_charge ? Number(r.setup_charge) : null, other_charge: r.other_charge ? Number(r.other_charge) : null })
    }
  }
  if (machineIds.length > 0) {
    const { data, error: machErr } = await service.from('machine_rates').select('id, name, cost, price, production_rate, units, setup_charge, other_charge').in('id', machineIds)
    console.log('[pricing] machine_rates loaded:', data?.length, 'error:', machErr?.message)
    for (const r of (data ?? []) as { id: string; name: string; cost: number | null; price: number | null; production_rate: number | null; units: string | null; setup_charge: number | null; other_charge: number | null }[])
      rateMap.set(r.id, { name: r.name, cost: Number(r.cost ?? 0), price: Number(r.price ?? 0), production_rate: r.production_rate ? Number(r.production_rate) : null, units: r.units, setup_charge: r.setup_charge ? Number(r.setup_charge) : null, other_charge: r.other_charge ? Number(r.other_charge) : null })
  }

  // 4. Load product modifiers + modifier definitions.
  // modifierMap is keyed by BOTH modifier id and system_lookup_name so callers
  // sending either kind of key resolve. The quote builder client currently
  // sends system_lookup_name keys; saved line_items.modifier_values follow the
  // same convention.
  const { data: pmRows } = await service
    .from('product_modifiers')
    .select('modifier_id')
    .eq('product_id', input.product_id)
  const modifierIds = ((pmRows ?? []) as { modifier_id: string | null }[])
    .map(r => r.modifier_id).filter(Boolean) as string[]

  type ModEntry = { id: string; name: string; system_lookup_name: string | null; modifier_type: string }
  const modifierMap = new Map<string, ModEntry>()
  if (modifierIds.length > 0) {
    const { data } = await service.from('modifiers').select('id, system_lookup_name, display_name, modifier_type').in('id', modifierIds)
    for (const m of (data ?? []) as { id: string; system_lookup_name: string | null; display_name: string; modifier_type: string }[]) {
      const entry: ModEntry = { id: m.id, name: m.display_name, system_lookup_name: m.system_lookup_name, modifier_type: m.modifier_type }
      modifierMap.set(m.id, entry)
      if (m.system_lookup_name) modifierMap.set(m.system_lookup_name, entry)
    }
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
    let rateSetup: number | null = null
    let rateOther: number | null = null

    if (refId && rateMap.has(refId)) {
      const r = rateMap.get(refId)!
      rateCost = r.cost
      ratePrice = r.price
      name = r.name
      productionRate = r.production_rate
      rateUnits = r.units
      rateSetup = r.setup_charge
      rateOther = r.other_charge
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

    let itemCost: number
    let itemPrice: number

    if (item.fixed_quantity && Number(item.fixed_quantity) > 0) {
      const fq = Number(item.fixed_quantity)
      const fqQty = item.charge_per_li_unit ? input.quantity : 1
      const effectiveQty = fq * mult * fqQty
      if (item.material_id) {
        const tier = findMaterialTier(materialTierMap.get(item.material_id), effectiveQty)
        if (tier) { rateCost = tier.cost; ratePrice = tier.price }
      }
      itemCost = rateCost * fq * mult * fqQty
      itemPrice = ratePrice * fq * mult * fqQty
    } else {
      const chargeQty = item.charge_per_li_unit ? input.quantity : 1
      const effectiveQty = fMult * mult * chargeQty
      if (item.material_id) {
        const tier = findMaterialTier(materialTierMap.get(item.material_id), effectiveQty)
        if (tier) { rateCost = tier.cost; ratePrice = tier.price }
      }
      const { totalCost, totalPrice } = computeLineItem(
        { name, cost: rateCost, price: ratePrice, markup: 1, production_rate: productionRate ?? undefined, setup_charge: rateSetup ?? undefined, other_charge: rateOther ?? undefined },
        fMult * mult,
        chargeQty,
      )
      itemCost = totalCost
      itemPrice = totalPrice
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

  // product_option_rates is deliberately NOT read or priced here anymore.
  // Investigation (known-issues/2026-08-19-product-option-rates-double-pricing.md)
  // found that every row in that table -- 5,903 of 5,903, across 625 of
  // 887 products, 558 of them active -- was an exact rate_id duplicate of
  // a row already in this same product's product_default_items (the
  // recipe loop above), meaning this section was double-charging labor
  // and machine costs on the majority of the live catalog. The
  // modifier-gating behavior this loop used to apply (modifier_formula,
  // gating a rate on/off by a product modifier's value) was the one
  // thing that would have made a row here meaningfully different from
  // its default_items twin -- confirmed via a full backup export
  // (backups/2026-08-20T00-31-39Z-product_option_rates.json) that 0 of
  // the 5,903 rows actually had modifier_formula set, so removing this
  // loop is a pure price correction, not a loss of any real feature.
  // The 5,903 rows themselves are untouched (see the known-issues doc
  // for the separate decision on what to do with them) -- this only
  // stops them from being summed into a price.

  const selectedMods = input.selected_modifiers ?? {}

  // 7. Apply modifier charges
  for (const [key, value] of Object.entries(selectedMods)) {
    const mod = modifierMap.get(key)
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
        modifier_id: mod.id,
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
        modifier_id: mod.id,
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

// ── Variant selection (Stage A) ──────────────────────────────────────
//
// Picks the material_variants row to price from, given a material's
// variants and the product's requested width. Returns null whenever no
// single variant can be chosen with confidence -- the caller falls back
// to the material's own flat cost/price in that case, unchanged from
// pre-Stage-A behavior. Never throws: an ambiguous or empty variant set
// is a *safe fallback*, not an error, because this sits directly in the
// path of a customer-facing quote price (quote-detail-client.tsx) and
// must never abort a price calculation.
//
// Rule, in order (see question 3 of the investigation report for the
// live counts behind each branch):
//   0 variants          -> null (fall back to materials.cost/price)
//   1 variant            -> use it
//   >1, width known      -> narrowest variant whose width still fits,
//                           mirroring smart-material-engine.ts's
//                           selectMaterial (src/lib/material-selection/
//                           smart-material-engine.ts:137-143). Works
//                           regardless of how many colours the material
//                           has -- it compares widths, not colours.
//   >1, no width match,
//     exactly 1 default  -> use it
//   >1, no width match,
//     >1 default         -> NOT a data error. is_default is scoped per
//                           (material, colour) by migration 181's
//                           partial unique index, so a multi-colour
//                           material legitimately has one default per
//                           colour. Colour is not known at pricing time
//                           (see part-1 report question 3) -- do not
//                           guess it. Fall back to null.
export type SelectableVariant = {
  id: string; material_id: string; width: number | null; height: number | null
  fixed_side: string | null; is_default: boolean | null
  cost_per_unit: number | null; sell_per_unit: number | null; sort_order: number | null
}

export function selectMaterialVariant(
  variants: SelectableVariant[],
  widthIn: number,
): (SelectableVariant & { _reason: string }) | null {
  if (variants.length === 0) return null
  if (variants.length === 1) return { ...variants[0], _reason: 'only_variant' }

  if (widthIn > 0) {
    const fitting = variants
      .filter(v => v.width != null && Number(v.width) >= widthIn)
      .sort((a, b) => Number(a.width) - Number(b.width))
    if (fitting.length > 0) return { ...fitting[0], _reason: 'narrowest_fit' }
  }

  const defaults = variants.filter(v => v.is_default === true)
  if (defaults.length === 1) return { ...defaults[0], _reason: 'single_default' }

  // >1 default (multi-colour) or 0 default, and no width match -- do not guess.
  return null
}

// ── Material pricing tier lookup ─────────────────────────────────────
//
// `tiers` must be sorted ascending by from_qty. Returns the tier whose
// [from_qty, to_qty] range covers `qty`. If qty falls in a gap between
// tiers (data-entry gap, or above the last tier's to_qty), falls back
// to the tier with the highest from_qty <= qty — never the flat rate,
// never an error. Returns null only if qty is below every tier's
// from_qty (no lower tier exists to fall back to).

function findMaterialTier(
  tiers: { from_qty: number; to_qty: number | null; cost: number; price: number }[] | undefined,
  qty: number,
): { cost: number; price: number } | null {
  if (!tiers || tiers.length === 0) return null
  let fallback: { cost: number; price: number } | null = null
  for (const t of tiers) {
    if (qty >= t.from_qty && (t.to_qty == null || qty <= t.to_qty)) return { cost: t.cost, price: t.price }
    if (t.from_qty <= qty) fallback = { cost: t.cost, price: t.price }
  }
  return fallback
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
