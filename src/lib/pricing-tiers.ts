// Shared validation for material_pricing_tiers quantity-break ranges.
// A tier covers [from_qty, to_qty] inclusive; to_qty === null means
// open-ended (e.g. "101+").

export type TierRange = { from_qty: number; to_qty: number | null }

export function rangesOverlap(a: TierRange, b: TierRange): boolean {
  const aTo = a.to_qty ?? Infinity
  const bTo = b.to_qty ?? Infinity
  return a.from_qty <= bTo && b.from_qty <= aTo
}

// Validates a single tier's shape. Returns an error message, or null if valid.
export function validateTierShape(t: { from_qty: unknown; to_qty: unknown; cost: unknown; price: unknown }): string | null {
  const from = Number(t.from_qty)
  if (!Number.isFinite(from) || from < 0) return 'From Qty must be a non-negative number.'
  if (t.to_qty !== null && t.to_qty !== undefined && t.to_qty !== '') {
    const to = Number(t.to_qty)
    if (!Number.isFinite(to)) return 'To Qty must be a number, or blank for open-ended.'
    if (to <= from) return 'To Qty must be greater than From Qty.'
  }
  const cost = Number(t.cost)
  if (!Number.isFinite(cost) || cost < 0) return 'Cost must be a non-negative number.'
  const price = Number(t.price)
  if (!Number.isFinite(price) || price < 0) return 'Price must be a non-negative number.'
  return null
}

// Checks a candidate range against a set of other existing ranges
// (already-saved tiers, excluding the one being edited). Returns an
// error message, or null if no overlap.
export function checkNoOverlap(candidate: TierRange, others: TierRange[]): string | null {
  const overlap = others.find((o) => rangesOverlap(candidate, o))
  if (!overlap) return null
  const otherLabel = overlap.to_qty == null ? `${overlap.from_qty}+` : `${overlap.from_qty}–${overlap.to_qty}`
  return `Range overlaps existing tier ${otherLabel}.`
}
