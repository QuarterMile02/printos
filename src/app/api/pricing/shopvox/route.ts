import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type ModifierValues = Record<string, boolean | number>

type ShopvoxDefaultItem = {
  idx?: number
  name: string
  kind: 'Material' | 'LaborRate' | 'MachineRate'
  formula: string | null
  multiplier: number | null
  per_li: boolean | null
  modifier: { kind: 'checkbox' | 'numeric' | 'formula'; expression: string } | null
  note?: string | null
}

type ShopvoxData = {
  pricing?: { range_discount?: string | null } | null
  default_items?: ShopvoxDefaultItem[]
  modifiers?: { name: string; type: 'Boolean' | 'Numeric' | 'Range'; default?: string | number | boolean | null }[]
}

type Body = {
  product_id: string
  width_inches?: number
  height_inches?: number
  quantity?: number
  modifier_values?: ModifierValues
}

type BreakdownLine = {
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body
    if (!body.product_id) {
      return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
    }
    const width = Number(body.width_inches ?? 0) || 0
    const height = Number(body.height_inches ?? 0) || 0
    const qty = Math.max(1, Math.floor(Number(body.quantity ?? 1) || 1))
    const modifierValues: ModifierValues = body.modifier_values ?? {}

    const service = createServiceClient()

    const { data: productRow } = await service
      .from('products')
      .select('id, organization_id, shopvox_data')
      .eq('id', body.product_id)
      .maybeSingle()
    const product = productRow as { id: string; organization_id: string; shopvox_data: ShopvoxData | null } | null
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const shopvox = product.shopvox_data ?? null
    const items = (shopvox?.default_items ?? []) as ShopvoxDefaultItem[]
    if (items.length === 0) {
      return NextResponse.json({
        breakdown: [],
        total_cost_cents: 0,
        total_sell_cents: 0,
        margin_pct: 0,
        breakdown_by_kind: { Material: 0, LaborRate: 0, MachineRate: 0 },
        warning: 'Recipe not yet extracted — shopvox_data.default_items is empty.',
      })
    }

    // Load only the rates we need by name, for the org.
    const wantedNames = Array.from(new Set(items.map((i) => i.name.trim()).filter(Boolean)))

    const [matsRes, laborRes, machineRes] = await Promise.all([
      service.from('materials').select('name, cost, price').eq('organization_id', product.organization_id).in('name', wantedNames),
      service.from('labor_rates').select('name, cost, price').eq('organization_id', product.organization_id).in('name', wantedNames),
      service.from('machine_rates').select('name, cost, price').eq('organization_id', product.organization_id).in('name', wantedNames),
    ])

    const matMap = new Map<string, { cost: number; price: number }>()
    for (const r of ((matsRes.data ?? []) as { name: string; cost: number | null; price: number | null }[])) {
      matMap.set(r.name.toLowerCase().trim(), { cost: Number(r.cost ?? 0), price: Number(r.price ?? 0) })
    }
    const laborMap = new Map<string, { cost: number; price: number }>()
    for (const r of ((laborRes.data ?? []) as { name: string; cost: number | null; price: number | null }[])) {
      laborMap.set(r.name.toLowerCase().trim(), { cost: Number(r.cost ?? 0), price: Number(r.price ?? 0) })
    }
    const machineMap = new Map<string, { cost: number; price: number }>()
    for (const r of ((machineRes.data ?? []) as { name: string; cost: number | null; price: number | null }[])) {
      machineMap.set(r.name.toLowerCase().trim(), { cost: Number(r.cost ?? 0), price: Number(r.price ?? 0) })
    }

    const breakdown: BreakdownLine[] = []
    let totalCost = 0
    let totalSell = 0
    const byKind = { Material: 0, LaborRate: 0, MachineRate: 0 } as Record<'Material' | 'LaborRate' | 'MachineRate', number>

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const mod = modifierMultiplier(item, modifierValues)
      const fResult = formulaResult(item.formula, width, height)
      const mult = Number(item.multiplier ?? 1) || 0
      const perLiFactor = item.per_li ? qty : 1
      const chargeQty = mod.inactive ? 0 : fResult * mult * mod.multiplier * perLiFactor

      const key = item.name.toLowerCase().trim()
      const rateMap = item.kind === 'Material' ? matMap : item.kind === 'LaborRate' ? laborMap : machineMap
      const rate = rateMap.get(key)
      const rateFound = !!rate
      const unitCost = rate?.cost ?? 0
      const unitSell = rate?.price ?? 0

      const totalCostCents = Math.round(unitCost * chargeQty * 100)
      const totalSellCents = Math.round(unitSell * chargeQty * 100)

      if (!mod.inactive) {
        totalCost += totalCostCents
        totalSell += totalSellCents
        byKind[item.kind] += totalCostCents
      }

      breakdown.push({
        idx: item.idx ?? i + 1,
        name: item.name,
        kind: item.kind,
        formula: item.formula ?? 'Unit',
        multiplier: mult,
        charge_qty: chargeQty,
        rate_cost_cents: Math.round(unitCost * 100),
        rate_sell_cents: Math.round(unitSell * 100),
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

    return NextResponse.json({
      breakdown,
      total_cost_cents: totalCost,
      total_sell_cents: totalSell,
      original_total_sell_cents: originalTotalSell,
      discount_percent: discountPercent || undefined,
      discount_type: discountType,
      margin_pct: marginPct,
      breakdown_by_kind: byKind,
    })
  } catch (err) {
    console.error('[/api/pricing/shopvox] Error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}
