export interface RateRecord {
  name: string
  cost: number
  price: number
  markup?: number
  production_rate?: number   // units processed per hour
  prod_rate_units?: string   // "Ft/Hr", "SqFt/Hr", "Units/Hr", etc.
  formula?: string           // "Unit", "Area", "Perimeter", etc.
  units?: string             // "Hr", "SqFt", "Each", etc.
  setup_charge?: number
  other_charge?: number
}

// ── Material cost formula ─────────────────────────────────────────────────────

export interface MaterialRecord {
  cost: number
  formula?: string | null
  fixed_side?: string | null   // 'width' | 'height' | 'both'
  width?: number | null        // fixed physical dimension, inches
  height?: number | null
  wastage_markup?: number | null  // percentage, e.g. 100 = charge 100% of waste
  calculate_wastage?: boolean | null
}

export interface MaterialLineResult {
  printArea: number         // sqft (or qty for non-Area formulas)
  wasteArea: number         // sqft of waste strip (before markup)
  chargeableWaste: number   // sqft charged after wastage_markup %
  formulaQty: number        // printArea + chargeableWaste
  finalQty: number          // after multiplier + per_li_unit logic
  lineTotal: number
  wasteStripInches: number  // inches of waste strip (for display)
  wastageMarkupPct: number
}

export function computeMaterialLineItem(
  material: MaterialRecord,
  userW: number,       // user-entered width, inches
  userH: number,       // user-entered height, inches
  orderQty: number,
  multiplier: number,
  perLiUnit: boolean,
): MaterialLineResult {
  const formula = (material.formula ?? 'area').toLowerCase().trim()
  const wastageMarkupPct = material.wastage_markup ?? 0

  let printArea = 0
  let wasteArea = 0
  let wasteStripInches = 0

  if (formula === 'area') {
    printArea = (userW / 12) * (userH / 12)

    if (material.calculate_wastage && material.fixed_side) {
      const matW = material.width ?? 0
      const matH = material.height ?? 0

      if (material.fixed_side === 'width') {
        // Roll width is fixed; waste = leftover height strip × print width
        const strip = matW - userH
        if (strip > 0) { wasteStripInches = strip; wasteArea = (strip / 12) * (userW / 12) }
      } else if (material.fixed_side === 'height') {
        const strip = matH - userW
        if (strip > 0) { wasteStripInches = strip; wasteArea = (strip / 12) * (userH / 12) }
      } else if (material.fixed_side === 'both') {
        const stripW = matW - userW
        const stripH = matH - userH
        if (stripW > 0) wasteArea += (stripW / 12) * (userH / 12)
        if (stripH > 0) wasteArea += (stripH / 12) * (userW / 12)
        wasteStripInches = Math.max(stripW > 0 ? stripW : 0, stripH > 0 ? stripH : 0)
      }
    }
  } else if (formula === 'perimeter') {
    printArea = 2 * ((userW / 12) + (userH / 12))
  } else if (formula === 'width') {
    printArea = userW / 12
  } else if (formula === 'height') {
    printArea = userH / 12
  } else {
    // Unit, None, or unknown — flat qty 1
    printArea = 1
  }

  const chargeableWaste = wasteArea * (wastageMarkupPct / 100)
  const formulaQty = printArea + chargeableWaste
  const chargeableQty = formulaQty * multiplier
  const finalQty = perLiUnit ? chargeableQty * orderQty : chargeableQty
  const lineTotal = (material.cost ?? 0) * finalQty

  return { printArea, wasteArea, chargeableWaste, formulaQty, finalQty, lineTotal, wasteStripInches, wastageMarkupPct }
}

// ── Rate-based cost (labor / machine) ────────────────────────────────────────

export function computeLineItem(
  rate: RateRecord,
  formulaQty: number,   // per-piece formula quantity (area in sqft, perimeter in ft, etc.)
  qty: number,          // order quantity (number of pieces)
): { totalCost: number; totalPrice: number; displayQty: number } {
  const prodRate  = rate.production_rate ?? 0
  const setupCost = rate.setup_charge    ?? 0
  const otherCost = rate.other_charge    ?? 0

  let chargeableUnits: number

  if (prodRate > 0) {
    // Rate is per hour with a production throughput (e.g. 200 Ft/Hr)
    chargeableUnits = formulaQty / prodRate
  } else {
    // Direct per-unit rate (per sqft, per linear ft, per piece)
    chargeableUnits = formulaQty
  }

  const totalCost  = (chargeableUnits * rate.cost  + setupCost + otherCost) * qty
  const totalPrice = (chargeableUnits * rate.price + setupCost + otherCost) * qty

  return {
    totalCost,
    totalPrice,
    displayQty: parseFloat(chargeableUnits.toFixed(4)),
  }
}
