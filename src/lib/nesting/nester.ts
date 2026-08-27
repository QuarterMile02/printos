// The nester: a pure geometry function for laying a product out on one
// candidate stock piece (sheet, roll, or discrete "both" item).
//
// SOURCE OF TRUTH: known-issues/2026-08-24-stage2-nesting-model-VERIFIED.md
// Implements that report's 11 worked test cases exactly (see
// nester.test.mts) plus the design choices the report explicitly left
// open for "the next design/build pass" (this one). Every choice beyond
// the 11 given numbers is documented inline where it's made, not buried.
//
// PURE. No I/O, no database, no Date.now, no randomness, no imports
// outside this file's own types. Same input -> same output, always.
// This function does not choose a variant or material, and it does not
// look at cost anywhere -- that is the selector's job, explicitly out of
// scope here (see the report's section 4).

export type FixedSide = 'none' | 'height' | 'width' | 'both'

// The VERIFIED report's own proposed NesterInput type (section 4) uses
// 'horizontal' | 'vertical' | 'either' for this field; the build
// instruction that commissioned this file lists 'horizontal' / 'vertical'
// / 'both' / 'none' instead -- a real, if minor, discrepancy between the
// two documents. Resolved in favor of the build instruction's enum: it is
// the more complete of the two (adds 'none', which a rigid material that
// can never be seamed genuinely needs) and 'both' is just a rename of the
// report's 'either'. Flagged in the PR description, not silently picked.
export type SeamDirection = 'horizontal' | 'vertical' | 'both' | 'none'

export type NesterInput = {
  // Candidate stock piece geometry, inches. One of these is nullable:
  // a roll's length (stock_height when fixed_side='width') is routinely
  // open-ended -- you cut whatever length the job needs, you don't track
  // "the roll's total length" here. A sheet's own two dimensions are
  // always both real numbers; a bounded roll width is always a real
  // number too. Passing null for the dimension fixed_side actually fixes
  // is treated as "does not fit" (never thrown), since that dimension is
  // the one piece of geometry this function cannot do without.
  stock_height: number | null
  stock_width: number | null
  fixed_side: FixedSide
  // Cut-to-length rounding: rounds the computed FREE-axis extent (the
  // dimension not fixed by fixed_side) up to the next multiple of this
  // value. null or <= 0 means no rounding. See test 7.
  length_increment: number | null

  product_height: number
  product_width: number
  quantity: number

  spacing: number // gap between adjacent images/bands, inches
  edge_margin: number // non-printable border, inches, trimmed once from every edge of the stock piece
  may_rotate: boolean // material.may_rotate AND product.may_rotate, pre-ANDed by the caller
  seam_overlap_width: number // inches of extra material consumed per seam
  seam_direction: SeamDirection
}

export type NesterOutput = {
  fits: boolean
  // Populated whenever fits=false (why not), and also for a handful of
  // fits=true edge states worth calling out (e.g. quantity=0). null
  // otherwise -- never an empty string standing in for "nothing to say."
  reason: string | null

  // "n-up": how many copies fit stacked along the FIXED axis within one
  // band/panel -- the industry sense of the term (how many copies one
  // pass of the material yields), not "how many were actually produced"
  // (that's quantity, capped/expanded across `across` bands -- see down
  // below). 0 when fits=false.
  n_up: number
  rotated: boolean

  // Explanatory detail so someone reading the output can see WHY,
  // without re-deriving the geometry: `down` = copies stacked along the
  // fixed axis within one band (== n_up when the product fits without
  // paneling; forced to 1 when paneled, since one oversized copy already
  // claims the entire fixed-axis capacity across its panels). `across`
  // = how many bands/independent copies were laid out along the free
  // axis to reach `quantity` (each paneled copy needs its own full run,
  // so across == quantity whenever paneled).
  down: number
  across: number

  // panels/seams describe ONE product instance's own geometry -- how
  // many stock-piece-lengths had to be joined because the product's own
  // measurement along the fixed axis exceeds the stock's fixed capacity.
  // panels >= 1 always; seams = panels - 1. Never scales with quantity
  // (each instance needing paneling repeats the SAME panel/seam count;
  // that repetition is folded into the aggregate areas below, not into
  // this count). Always 1/0 for fixed_side 'both' and 'none' -- neither
  // ever seams.
  panels: number
  seams: number

  // Aggregate areas across ALL `quantity` copies actually placed
  // (0 when quantity is 0 or fits is false).
  consumed_sqft: number
  product_sqft: number
  offcut_sqft: number
  remainder_sqft: number
}

const SQIN_PER_SQFT = 144
const EPS = 1e-9

function clampNonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}

// How many items of size `item` fit along a span of length `usable`,
// each separated from the next by `gap` (n items need n*item + (n-1)*gap
// <= usable). Returns 0 if even one doesn't fit.
function fitCount(usable: number, item: number, gap: number): number {
  if (usable <= 0 || item <= 0) return 0
  const n = Math.floor((usable + gap + EPS) / (item + gap))
  return n > 0 ? n : 0
}

// Rounds `value` up to the next multiple of `increment`. A value exactly
// on a multiple is left alone (the EPS guard is what makes "exactly 24
// with a 12 increment" come back as 24, not 36 -- pure floating-point
// n/increment can land a hair over an exact multiple and ceil() would
// wrongly bump it). null/<=0 increment means no rounding at all.
function roundUpToIncrement(value: number, increment: number | null): number {
  if (increment == null || increment <= 0) return value
  return Math.ceil(value / increment - EPS) * increment
}

function zeroResult(reason: string): NesterOutput {
  return {
    fits: false,
    reason,
    n_up: 0,
    rotated: false,
    down: 0,
    across: 0,
    panels: 0,
    seams: 0,
    consumed_sqft: 0,
    product_sqft: 0,
    offcut_sqft: 0,
    remainder_sqft: 0,
  }
}

type OrientationResult = {
  rotated: boolean
  down: number
  across: number
  panels: number
  seams: number
  consumedSqft: number
  productSqft: number
}

// Evaluates ONE orientation (rotated or not) for fixed_side 'height' or
// 'width'. `stockFixed`/`stockFree` and `productFixed`/`productFree` are
// already resolved to whichever of height/width the caller's fixed_side
// puts on each axis -- this function doesn't know or care which is
// "really" height vs width, only which is fixed vs free, so the same
// code serves both fixed_side values (see nestMaterial below).
function evaluateFixedOrientation(args: {
  rotated: boolean
  stockFixed: number
  stockFree: number | null // null = unbounded (a roll's open-ended length)
  productFixed: number
  productWidthOnFree: number
  quantity: number
  spacing: number
  edgeMargin: number
  lengthIncrement: number | null
  seamOverlapWidth: number
  seamDirection: SeamDirection
}): OrientationResult | { fail: string } {
  const {
    rotated, stockFixed, stockFree, productFixed, productWidthOnFree, quantity,
    spacing, edgeMargin, lengthIncrement, seamOverlapWidth, seamDirection,
  } = args

  const usableFixed = stockFixed - 2 * edgeMargin
  const down = fitCount(usableFixed, productFixed, spacing)

  if (down >= 1) {
    // Fits within one band/panel along the fixed axis -- no seaming
    // needed. `across` bands, side by side along the free axis, cover
    // the requested quantity; only the last band is partially filled.
    const across = quantity > 0 ? Math.ceil(quantity / down) : 0
    let consumedFreeExtent = across > 0 ? across * productWidthOnFree + (across - 1) * spacing : 0
    consumedFreeExtent = roundUpToIncrement(consumedFreeExtent, lengthIncrement)

    if (stockFree != null && consumedFreeExtent > stockFree + EPS) {
      return { fail: 'requested quantity needs more of the free dimension than this stock piece has' }
    }

    const consumedSqft = (stockFixed * consumedFreeExtent) / SQIN_PER_SQFT
    return {
      rotated, down, across, panels: 1, seams: 0,
      consumedSqft, productSqft: (quantity * productFixed * productWidthOnFree) / SQIN_PER_SQFT,
    }
  }

  // Doesn't fit even once along the fixed axis -- the only rescue is
  // paneling: join multiple full stock-fixed lengths, seamed together,
  // to cover the product's own fixed-axis measurement. Simplification,
  // stated plainly: only 'none' is treated as an unambiguous refusal
  // here. The report doesn't say which physical direction ("horizontal"/
  // "vertical") a height-fixed sheet's seam runs vs a width-fixed roll's,
  // and guessing that mapping wrong would silently reject (or silently
  // allow) real paneling the wrong way -- worse than not encoding the
  // distinction at all. So 'horizontal', 'vertical', and 'both' are all
  // treated as "seaming is permitted"; only 'none' blocks it. Flagged in
  // the PR description as a real gap, not a guess dressed up as one.
  if (usableFixed <= 0) return { fail: 'edge margin leaves no usable space along the fixed dimension' }
  if (seamDirection === 'none') return { fail: 'product exceeds the fixed dimension and this material forbids seaming' }

  const panels = Math.ceil(productFixed / usableFixed - EPS)
  const seams = panels - 1
  const consumedFreeExtent = roundUpToIncrement(productWidthOnFree, lengthIncrement)
  const extraFromSeams = (seams * seamOverlapWidth * consumedFreeExtent) / SQIN_PER_SQFT

  if (stockFree != null && consumedFreeExtent > stockFree + EPS) {
    return { fail: 'product exceeds the free dimension even after paneling the fixed dimension' }
  }

  const consumedSqftPerInstance = (panels * stockFixed * consumedFreeExtent) / SQIN_PER_SQFT + extraFromSeams
  const productSqftPerInstance = (productFixed * productWidthOnFree) / SQIN_PER_SQFT
  const across = quantity // paneled: every copy needs its own full run, nothing shared

  return {
    rotated, down: 1, across, panels, seams,
    consumedSqft: consumedSqftPerInstance * quantity,
    productSqft: productSqftPerInstance * quantity,
  }
}

export function nestMaterial(input: NesterInput): NesterOutput {
  const quantity = Math.max(0, Math.round(Number.isFinite(input.quantity) ? input.quantity : 0))
  const spacing = clampNonNegative(input.spacing)
  const edgeMargin = clampNonNegative(input.edge_margin)
  const seamOverlapWidth = clampNonNegative(input.seam_overlap_width)
  const lengthIncrement = input.length_increment != null && input.length_increment > 0 ? input.length_increment : null

  if (!(input.product_height > 0) || !(input.product_width > 0)) {
    return zeroResult('product height and width must both be positive')
  }

  // ── fixed_side = 'none' — a unit item, not measured by area at all.
  if (input.fixed_side === 'none') {
    return {
      fits: true, reason: quantity === 0 ? 'quantity is 0 -- nothing consumed' : null,
      n_up: quantity, rotated: false, down: quantity, across: quantity > 0 ? 1 : 0,
      panels: 1, seams: 0,
      consumed_sqft: 0, product_sqft: 0, offcut_sqft: 0, remainder_sqft: 0,
    }
  }

  // ── fixed_side = 'both' — the entire piece is consumed as one
  // indivisible unit, no partial return, remainder always 0. No
  // paneling mechanism exists for 'both' in the report -- a product that
  // doesn't fit in the whole piece, in either orientation, just doesn't
  // fit (no "join two boxes together" concept).
  if (input.fixed_side === 'both') {
    if (input.stock_height == null || input.stock_width == null || input.stock_height <= 0 || input.stock_width <= 0) {
      return zeroResult('fixed_side is both but stock height/width is missing or non-positive')
    }
    const usableH = input.stock_height - 2 * edgeMargin
    const usableW = input.stock_width - 2 * edgeMargin
    const pieceSqft = (input.stock_height * input.stock_width) / SQIN_PER_SQFT

    const plain = fitCount(usableH, input.product_height, spacing) * fitCount(usableW, input.product_width, spacing)
    const canRotate = input.may_rotate && (input.product_height !== input.product_width)
    const flipped = canRotate
      ? fitCount(usableH, input.product_width, spacing) * fitCount(usableW, input.product_height, spacing)
      : 0

    const rotated = flipped > plain
    const perWhole = rotated ? flipped : plain
    if (perWhole < 1) return zeroResult('product does not fit in the piece in either orientation, and fixed_side=both has no paneling mechanism')

    const wholePiecesNeeded = quantity > 0 ? Math.ceil(quantity / perWhole) : 0
    const consumedSqft = wholePiecesNeeded * pieceSqft
    const productSqft = (quantity * input.product_height * input.product_width) / SQIN_PER_SQFT
    const rowsChosen = rotated ? fitCount(usableH, input.product_width, spacing) : fitCount(usableH, input.product_height, spacing)
    const colsChosen = rotated ? fitCount(usableW, input.product_height, spacing) : fitCount(usableW, input.product_width, spacing)

    return {
      fits: true, reason: quantity === 0 ? 'quantity is 0 -- nothing consumed' : null,
      n_up: perWhole, rotated, down: rowsChosen, across: colsChosen * wholePiecesNeeded,
      panels: 1, seams: 0,
      consumed_sqft: consumedSqft, product_sqft: productSqft,
      offcut_sqft: consumedSqft - productSqft, remainder_sqft: 0,
    }
  }

  // ── fixed_side = 'height' (sheets) or 'width' (rolls) ──────────────
  const isRoll = input.fixed_side === 'width'
  const stockFixed = isRoll ? input.stock_width : input.stock_height
  const stockFree = isRoll ? input.stock_height : input.stock_width // may be null (roll length open-ended)

  if (stockFixed == null || stockFixed <= 0) {
    return zeroResult(`fixed_side is ${input.fixed_side} but stock ${isRoll ? 'width' : 'height'} is missing or non-positive`)
  }

  const pieceSqftIfBounded = stockFree != null ? (stockFixed * stockFree) / SQIN_PER_SQFT : null

  // Orientation A: product as given. Orientation B: rotated 90 deg.
  // "productFixed"/"productWidthOnFree" name which of the product's own
  // height/width lies along which stock axis for this orientation.
  const orientA = { productFixed: isRoll ? input.product_width : input.product_height, productFree: isRoll ? input.product_height : input.product_width }
  const orientB = { productFixed: isRoll ? input.product_height : input.product_width, productFree: isRoll ? input.product_width : input.product_height }

  const evalArgsBase = {
    stockFixed, stockFree, quantity, spacing, edgeMargin: edgeMargin,
    lengthIncrement, seamOverlapWidth, seamDirection: input.seam_direction,
    pieceSqftIfBounded, isRoll,
  }

  const resultA = evaluateFixedOrientation({ ...evalArgsBase, rotated: false, productFixed: orientA.productFixed, productWidthOnFree: orientA.productFree })
  const canRotate = input.may_rotate && (input.product_height !== input.product_width)
  const resultB = canRotate
    ? evaluateFixedOrientation({ ...evalArgsBase, rotated: true, productFixed: orientB.productFixed, productWidthOnFree: orientB.productFree })
    : { fail: 'rotation not attempted -- may_rotate is false or the product is square' }

  const okA = 'fail' in resultA ? null : resultA
  const okB = 'fail' in resultB ? null : resultB

  let chosen: OrientationResult | null
  if (okA && okB) {
    // Prefer whichever orientation consumes less material overall; a tie
    // (including the trivial quantity=0 tie) keeps the non-rotated
    // orientation, matching test 2's principle that rotating is only
    // taken when it actually reduces the footprint.
    chosen = okB.consumedSqft < okA.consumedSqft - EPS ? okB : okA
  } else {
    chosen = okA ?? okB
  }

  if (!chosen) {
    const reason = !('fail' in resultA) ? '' : resultA.fail
    return zeroResult(reason || 'product does not fit in either orientation')
  }

  const remainderSqft = isRoll || pieceSqftIfBounded == null
    ? 0 // roll: leftover length isn't a bounded-piece concept (see report section 1.3); also covers an unbounded free axis generally
    : chosen.panels > 1
      ? 0 // paneled: multiple physical pieces are joined into one graphic, "the piece" no longer refers to a single bounded rectangle
      : Math.max(0, pieceSqftIfBounded - chosen.consumedSqft)

  return {
    fits: true,
    reason: quantity === 0 ? 'quantity is 0 -- nothing consumed' : null,
    n_up: chosen.down,
    rotated: chosen.rotated,
    down: chosen.down,
    across: chosen.across,
    panels: chosen.panels,
    seams: chosen.seams,
    consumed_sqft: chosen.consumedSqft,
    product_sqft: chosen.productSqft,
    offcut_sqft: Math.max(0, chosen.consumedSqft - chosen.productSqft),
    remainder_sqft: remainderSqft,
  }
}
