// Pure computation for /api/pricing/shopvox, split out of the route so it's
// directly callable (verification scripts, tests) the same way
// calculateProductPrice() in formula-engine.ts already is -- no behavior
// change intended from what the route did inline before, EXCEPT one real
// bug fixed alongside the extraction (see below) -- this route had zero
// callers anywhere in the app until this task wired the reference panel to
// it, so this is the first time its field names were ever checked against
// real scraped data.
//
// Prices a product's SCRAPED ShopVOX recipe (shopvox_data.default_items,
// each carrying its own formula/multiplier) against this org's CURRENT
// materials/labor_rates/machine_rates costs. This is deliberately NOT
// calculateProductPrice() -- that prices the org's already-BUILT
// product_default_items recipe; this prices the raw ShopVOX scrape as a
// reference/comparison point before (or instead of) that recipe exists.
//
// BUG FIXED HERE: the pre-existing type/code read `item.kind` and
// `item.per_li` -- neither exists on a real default_items row. Confirmed
// live against Coroplast 4mm- Direct Printing's actual shopvox_data: the
// real fields are `item_type` ("Material"/"LaborRate"/"MachineRate") and
// `per_li_unit`. With the old field names, `item.kind` was undefined for
// every row, so the kind-based rate lookup
// (`item.kind === 'Material' ? matMap : item.kind === 'LaborRate' ? laborMap
// : machineMap`) silently fell through to machineMap for EVERY item
// regardless of its real type -- confirmed live: 15 of Coroplast's 16
// items came back "no rate match" ($0), and the one that didn't
// ("Laminator") only matched by coincidence, because it's actually a
// MachineRate. Renamed to the real field names below; nothing else about
// the calculation changed.
//
// SECOND BUG FIXED HERE: labor/machine rates priced per-hour with a
// production_rate throughput (e.g. "$97.87/Hr, 48 SqFt/Hr") need the
// formula quantity divided by production_rate to get billable hours
// BEFORE multiplying by the rate -- formula-engine.ts's computeLineItem()
// (reused below, not reimplemented) already does exactly this for the
// product_default_items pricing path. This route's original inline
// calculation skipped that division entirely (`unitCost * chargeQty`
// directly), so for every Hr-rated item it charged the FULL hourly rate
// per sqft/linear-ft instead of per hour of actual production time.
// Confirmed live: Coroplast 4mm at 48x96in priced at $14,146.72 before
// this fix, $870.81 after -- a ~16x inflation that would have made the
// whole reference-comparison tool this task exists to build worthless for
// any Hr-rated item, which is most labor and machine rates in this
// catalog.
//
// Separately noted, NOT resolved here: that $870.81 does not match this
// same product's already-BUILT PrintOS recipe price at the same
// dimensions (calculateProductPrice() / product_default_items) -- $244.99
// once formula-engine.ts's own product_option_rates double-pricing bug is
// fixed (PR #22; Coroplast has 11 product_option_rates rows, so its
// pre-#22 built number, $437.12, was itself inflated -- checked both).
// Root cause looks methodological, not a bug in either function:
// calculateProductPrice() prices as (total COST across all items) x (one
// product-level markup), while this function sums each item's own
// INDIVIDUAL sell price directly -- two different pricing philosophies
// already present in this codebase, not something this task reconciles.
// Whether they SHOULD agree, and if so which one is right, is a real open
// question for whoever validates pricing methodology next -- out of scope
// here, which is specifically about getting Width/Height wired into this
// reference path so Ruben can compare it against ShopVOX's own Check
// Pricing screen, not about reconciling it against
// PrintOS's separate built-recipe pricing model.
//
// NOT fixed here, flagged as a separate finding: real default_items rows
// have no top-level `modifier` field either (checkbox/numeric gating info
// actually lives nested under `modal.numeric_modifier`/
// `modal.checkbox_modifier`, as plain strings -- sometimes a bare modifier
// name, sometimes what looks like a ternary expression, e.g.
// "Double_Sided ? 2 : 1;", which the existing arithmetic-only
// evalModifierExpression() below can't evaluate anyway). Effect: every
// item's modifier gating is currently inert (modifierMultiplier() always
// takes its "no modifier" branch, multiplier 1, never inactive) --
// harmless for THIS task's Width/Height verification (nothing gets
// incorrectly zeroed out), but real modifier-driven pricing differences
// won't show up in this reference tool until that's investigated and
// fixed separately -- it's a bigger, riskier change (real expression
// grammar unclear, unknown how many products depend on it) than belongs
// in this pass.

import { createServiceClient } from '@/lib/supabase/server'
import { computeLineItem, type RateRecord } from './compute-line-item'

export type ModifierValues = Record<string, boolean | number>

export type ShopvoxDefaultItem = {
  idx?: number
  name: string
  item_type: 'Material' | 'LaborRate' | 'MachineRate'
  formula: string | null
  multiplier: number | string | null
  per_li_unit: boolean | null
  modifier: { kind: 'checkbox' | 'numeric' | 'formula'; expression: string } | null
  note?: string | null
}

export type ShopvoxData = {
  pricing?: { range_discount?: string | null } | null
  default_items?: ShopvoxDefaultItem[]
  modifiers?: { name: string; type: 'Boolean' | 'Numeric' | 'Range'; default?: string | number | boolean | null }[]
}

export type ShopvoxReferencePriceInput = {
  product_id: string
  width_inches?: number
  height_inches?: number
  quantity?: number
  modifier_values?: ModifierValues
}

export type ShopvoxBreakdownLine = {
  idx: number
  name: string
  kind: 'Material' | 'LaborRate' | 'MachineRate'
  formula: string
  multiplier: number
  charge_qty: number
  rate_cost_cents: number
  rate_sell_cents: number
  total_cost_cents: number
  total_sell_cents: number
  inactive: boolean
  inactive_reason: string | null
  rate_found: boolean
  modifier_expression: string | null
}

export type ShopvoxReferencePriceResult = {
  breakdown: ShopvoxBreakdownLine[]
  total_cost_cents: number
  total_sell_cents: number
  original_total_sell_cents?: number
  discount_percent?: number
  discount_type?: string
  margin_pct: number
  breakdown_by_kind: Record<'Material' | 'LaborRate' | 'MachineRate', number>
  warning?: string
  error?: string
  not_found?: boolean
}

function formulaResult(formula: string | null | undefined, w: number, h: number): number {
  switch (formula) {
    case 'Area':      return (w * h) / 144
    case 'Perimeter': return (2 * (w + h)) / 12
    case 'Width':     return w / 12
    case 'Height':    return h / 12
    case 'Unit':      return 1
    case 'None':      return 1
    default:          return 1
  }
}

// Safe arithmetic eval: only accepts [A-Za-z_][A-Za-z0-9_]* identifiers,
// numbers, + - * / ( ) and whitespace. Identifiers resolve from values
// (booleans → 0/1, numbers → number, missing → 0).
function evalModifierExpression(expr: string, values: ModifierValues): number {
  const substituted = expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => {
    const v = values[id]
    if (typeof v === 'boolean') return v ? '1' : '0'
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    return '0'
  })
  if (!/^[\d+\-*/().\s]*$/.test(substituted)) return 0
  try {
    const fn = new Function(`"use strict"; return (${substituted})`) as () => number
    const r = fn()
    return typeof r === 'number' && Number.isFinite(r) ? r : 0
  } catch {
    return 0
  }
}

function modifierMultiplier(
  item: ShopvoxDefaultItem,
  values: ModifierValues,
): { multiplier: number; inactive: boolean; reason: string | null } {
  const mod = item.modifier
  if (!mod) return { multiplier: 1, inactive: false, reason: null }
  if (mod.kind === 'checkbox') {
    const v = values[mod.expression]
    const active = v === true || (typeof v === 'number' && v > 0)
    return { multiplier: active ? 1 : 0, inactive: !active, reason: active ? null : `${mod.expression} not selected` }
  }
  if (mod.kind === 'numeric') {
    const raw = values[mod.expression]
    const n = typeof raw === 'number' ? raw : typeof raw === 'boolean' ? (raw ? 1 : 0) : 0
    return { multiplier: n, inactive: n === 0, reason: n === 0 ? `${mod.expression} is 0` : null }
  }
  // formula
  const result = evalModifierExpression(mod.expression, values)
  return { multiplier: result, inactive: result === 0, reason: result === 0 ? 'all gating modifiers off' : null }
}

export async function calculateShopvoxReferencePrice(
  input: ShopvoxReferencePriceInput,
): Promise<ShopvoxReferencePriceResult & { organization_id?: string }> {
  const width = Number(input.width_inches ?? 0) || 0
  const height = Number(input.height_inches ?? 0) || 0
  const qty = Math.max(1, Math.floor(Number(input.quantity ?? 1) || 1))
  const modifierValues: ModifierValues = input.modifier_values ?? {}

  const service = createServiceClient()

  const { data: productRow } = await service
    .from('products')
    .select('id, organization_id, shopvox_data')
    .eq('id', input.product_id)
    .maybeSingle()
  const product = productRow as { id: string; organization_id: string; shopvox_data: ShopvoxData | null } | null
  if (!product) {
    return {
      breakdown: [], total_cost_cents: 0, total_sell_cents: 0, margin_pct: 0,
      breakdown_by_kind: { Material: 0, LaborRate: 0, MachineRate: 0 },
      error: 'Product not found', not_found: true,
    }
  }

  const shopvox = product.shopvox_data ?? null
  const items = (shopvox?.default_items ?? []) as ShopvoxDefaultItem[]
  if (items.length === 0) {
    return {
      breakdown: [], total_cost_cents: 0, total_sell_cents: 0, margin_pct: 0,
      breakdown_by_kind: { Material: 0, LaborRate: 0, MachineRate: 0 },
      warning: 'Recipe not yet extracted — shopvox_data.default_items is empty.',
      organization_id: product.organization_id,
    }
  }

  // Load only the rates we need by name, for the org. production_rate/
  // setup_charge/other_charge only apply to labor/machine (Hr-rated)
  // rates -- materials are priced directly per formula unit, same as
  // formula-engine.ts's own rateMap construction (production_rate: null
  // there too), so computeLineItem's "no production rate -> use the
  // formula quantity directly" branch already does the right thing for
  // them with no special-casing needed here.
  const wantedNames = Array.from(new Set(items.map((i) => i.name.trim()).filter(Boolean)))

  const [matsRes, laborRes, machineRes] = await Promise.all([
    service.from('materials').select('name, cost, price').eq('organization_id', product.organization_id).in('name', wantedNames),
    service.from('labor_rates').select('name, cost, price, production_rate, units, setup_charge, other_charge').eq('organization_id', product.organization_id).in('name', wantedNames),
    service.from('machine_rates').select('name, cost, price, production_rate, units, setup_charge, other_charge').eq('organization_id', product.organization_id).in('name', wantedNames),
  ])

  type RateRow = { name: string; cost: number | null; price: number | null; production_rate?: number | null; units?: string | null; setup_charge?: number | null; other_charge?: number | null }
  function toRateRecord(r: RateRow): RateRecord {
    return {
      name: r.name,
      cost: Number(r.cost ?? 0),
      price: Number(r.price ?? 0),
      production_rate: r.production_rate ? Number(r.production_rate) : undefined,
      units: r.units ?? undefined,
      setup_charge: r.setup_charge ? Number(r.setup_charge) : undefined,
      other_charge: r.other_charge ? Number(r.other_charge) : undefined,
    }
  }

  const matMap = new Map<string, RateRecord>()
  for (const r of ((matsRes.data ?? []) as RateRow[])) matMap.set(r.name.toLowerCase().trim(), toRateRecord(r))
  const laborMap = new Map<string, RateRecord>()
  for (const r of ((laborRes.data ?? []) as RateRow[])) laborMap.set(r.name.toLowerCase().trim(), toRateRecord(r))
  const machineMap = new Map<string, RateRecord>()
  for (const r of ((machineRes.data ?? []) as RateRow[])) machineMap.set(r.name.toLowerCase().trim(), toRateRecord(r))

  const breakdown: ShopvoxBreakdownLine[] = []
  let totalCost = 0
  let totalSell = 0
  const byKind = { Material: 0, LaborRate: 0, MachineRate: 0 } as Record<'Material' | 'LaborRate' | 'MachineRate', number>

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const mod = modifierMultiplier(item, modifierValues)
    const fResult = formulaResult(item.formula, width, height)
    const mult = Number(item.multiplier ?? 1) || 0
    // Per-piece formula quantity (sqft/linear-ft/etc, BEFORE production_rate
    // division and BEFORE order quantity) -- computeLineItem applies both
    // of those internally, same call shape formula-engine.ts already uses.
    const formulaQty = fResult * mult * mod.multiplier
    const orderQty = item.per_li_unit ? qty : 1

    const key = item.name.toLowerCase().trim()
    const rateMap = item.item_type === 'Material' ? matMap : item.item_type === 'LaborRate' ? laborMap : machineMap
    const rate = rateMap.get(key)
    const rateFound = !!rate

    const line = mod.inactive || !rate
      ? { totalCost: 0, totalPrice: 0, computed_qty: 0 }
      : computeLineItem(rate, formulaQty, orderQty)

    const totalCostCents = Math.round(line.totalCost * 100)
    const totalSellCents = Math.round(line.totalPrice * 100)

    if (!mod.inactive) {
      totalCost += totalCostCents
      totalSell += totalSellCents
      byKind[item.item_type] += totalCostCents
    }

    breakdown.push({
      idx: item.idx ?? i + 1,
      name: item.name,
      kind: item.item_type,
      formula: item.formula ?? 'Unit',
      multiplier: mult,
      charge_qty: line.computed_qty,
      rate_cost_cents: Math.round((rate?.cost ?? 0) * 100),
      rate_sell_cents: Math.round((rate?.price ?? 0) * 100),
      total_cost_cents: totalCostCents,
      total_sell_cents: totalSellCents,
      inactive: mod.inactive,
      inactive_reason: mod.reason,
      rate_found: rateFound,
      modifier_expression: item.modifier?.expression ?? null,
    })
  }

  // Range discount lookup by name (shopvox_data.pricing.range_discount)
  let discountPercent = 0
  let discountType: string | undefined
  let originalTotalSell = totalSell
  const rangeName = shopvox?.pricing?.range_discount
  if (rangeName && totalSell > 0) {
    const { data: discount } = await service
      .from('discounts')
      .select('id')
      .eq('organization_id', product.organization_id)
      .eq('name', rangeName)
      .maybeSingle()
    const d = discount as { id: string } | null
    if (d) {
      const { data: tiers } = await service
        .from('discount_tiers')
        .select('min_qty, max_qty, discount_percent')
        .eq('discount_id', d.id)
        .order('min_qty', { ascending: true })
      const area = (width * height) / 144
      for (const t of ((tiers ?? []) as { min_qty: number; max_qty: number | null; discount_percent: number | null }[])) {
        const min = Number(t.min_qty)
        const max = t.max_qty == null ? Infinity : Number(t.max_qty)
        if (area >= min && area <= max) {
          discountPercent = Number(t.discount_percent ?? 0)
          discountType = 'Range'
          break
        }
      }
    }
  }
  if (discountPercent > 0) {
    originalTotalSell = totalSell
    totalSell = Math.round(totalSell * (1 - discountPercent / 100))
  }

  const marginPct = totalSell > 0 ? Math.max(0, Math.min(100, ((totalSell - totalCost) / totalSell) * 100)) : 0

  return {
    breakdown,
    total_cost_cents: totalCost,
    total_sell_cents: totalSell,
    original_total_sell_cents: originalTotalSell,
    discount_percent: discountPercent || undefined,
    discount_type: discountType,
    margin_pct: marginPct,
    breakdown_by_kind: byKind,
    organization_id: product.organization_id,
  }
}
