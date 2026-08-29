'use client'

import { useMemo, useState } from 'react'
import { nestMaterial, type FixedSide, type NesterOutput } from '@/lib/nesting/nester'

export type VariantOption = {
  id: string
  materialName: string
  colourName: string | null
  height: number | null
  width: number | null
  lengthUom: string
  sourceName: string | null
  fixedSide: FixedSide
  lengthIncrement: number | null
  direction: string | null
  baseCost: number | null
  multiplier: number
  costPerUnit: number | null
  sellPerUnit: number | null
  // From the MATERIAL (materials.wastage_markup / materials.calculate_wastage
  // -- confirmed live columns, 010_product_builder_FIXED.sql:100), not the
  // variant. Raw, null and all -- nothing here defaults a missing markup.
  wastageMarkup: number | null
  calculateWastage: boolean
}

// Mirrors migration 173's material_length_to_feet() SQL function exactly
// (in -> /12, ft -> as-is, yd -> *3 to get feet), just landing on inches
// instead of feet since that's what nestMaterial takes. width is ALWAYS
// inches regardless of length_uom (173's own column comment) -- only
// height is ever converted.
function lengthToInches(value: number, uom: string): number {
  switch (uom) {
    case 'ft': return value * 12
    case 'yd': return value * 36
    case 'in':
    default: return value
  }
}

function fmtDim(n: number | null): string {
  return n == null ? '—' : `${Number(n).toString()}in`
}

function fmtSqft(n: number): string {
  return n.toFixed(4)
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`
}

// Full precision for rate inputs (cost_per_unit, sell_per_unit,
// wastage_markup, multiplier) -- never round a rate before multiplying
// by it; this is for DISPLAYING the rate alongside the money math, not
// for computing with.
function fmtRate(n: number): string {
  return n.toFixed(4)
}

// The nester's own OrientationResult defines "the whole piece" two
// different ways depending on shape -- see nester.ts and nester.test.mts's
// assertInvariant for the same split applied to the automated tests.
// Bounded, unpaneled single sheet: an INDEPENDENT number, stock_height x
// stock_width, computed from the variant's own stored dimensions -- a
// genuine check that can actually fail if the nester's internal
// accounting ever drifts from the real stock size. Everything else
// (rolls, fixed_side=both/none, or any paneled result) has no
// independently-bounded "whole piece" to check against by the model's
// own definition -- consumed_sqft stands in for it, which makes the
// check self-consistent by construction, not a null check, and that
// distinction is surfaced in the UI rather than hidden.
function wholePieceSqft(v: VariantOption, out: NesterOutput): { value: number; independent: boolean } {
  const isRoll = v.fixedSide === 'width'
  if (isRoll || v.fixedSide === 'both' || v.fixedSide === 'none' || out.panels > 1) {
    return { value: out.consumed_sqft_total, independent: false }
  }
  if (v.height == null || v.width == null) {
    return { value: out.consumed_sqft_total, independent: false }
  }
  const stockHeightIn = lengthToInches(v.height, v.lengthUom)
  return { value: (stockHeightIn * v.width) / 144, independent: true }
}

// Fields ending _total already have quantity applied (whole job);
// everything else describes one instance's geometry -- same rule
// stated on NesterOutput itself (nester.ts).
const OUTPUT_ROWS: { key: keyof NesterOutput; label: string; format: (out: NesterOutput) => string }[] = [
  { key: 'fits', label: 'Fits', format: (o) => (o.fits ? 'Yes' : 'No') },
  { key: 'reason', label: 'Reason', format: (o) => o.reason ?? '—' },
  { key: 'n_up', label: 'N-up (copies per band/panel)', format: (o) => String(o.n_up) },
  { key: 'rotated', label: 'Rotated', format: (o) => (o.rotated ? 'Yes' : 'No') },
  { key: 'down', label: 'Down (stacked along the fixed axis)', format: (o) => String(o.down) },
  { key: 'across_total', label: 'Across (bands along the free axis, whole job)', format: (o) => String(o.across_total) },
  { key: 'panels', label: 'Panels', format: (o) => String(o.panels) },
  { key: 'seams', label: 'Seams', format: (o) => String(o.seams) },
  { key: 'seam_length_in_total', label: 'Seam length (whole job, inches)', format: (o) => o.seam_length_in_total.toFixed(2) },
  { key: 'consumed_sqft_total', label: 'Consumed (whole job, sqft)', format: (o) => fmtSqft(o.consumed_sqft_total) },
  { key: 'product_sqft_total', label: 'Product (whole job, sqft)', format: (o) => fmtSqft(o.product_sqft_total) },
  { key: 'offcut_sqft_total', label: 'Offcut (whole job, sqft)', format: (o) => fmtSqft(o.offcut_sqft_total) },
  { key: 'remainder_sqft_total', label: 'Remainder (whole job, sqft)', format: (o) => fmtSqft(o.remainder_sqft_total) },
]

export default function NestingSandboxClient({ variants }: { variants: VariantOption[] }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(variants[0]?.id ?? null)
  const [productHeight, setProductHeight] = useState('12')
  const [productWidth, setProductWidth] = useState('12')
  const [quantity, setQuantity] = useState('1')
  const [seamOverlapWidth, setSeamOverlapWidth] = useState('0')
  // null = "no manual override yet -- use the direction-derived default."
  // Reset whenever the selected variant changes so a previous manual
  // toggle never silently carries over onto a different material --
  // done during render (React's own recommended "adjusting state when a
  // prop changes" pattern), not in an effect, so there's no extra render
  // pass or lint violation from setState-in-effect.
  const [mayRotateOverride, setMayRotateOverride] = useState<boolean | null>(null)
  const [lastSelectedId, setLastSelectedId] = useState(selectedId)
  if (selectedId !== lastSelectedId) {
    setLastSelectedId(selectedId)
    setMayRotateOverride(null)
  }

  const selected = variants.find((v) => v.id === selectedId) ?? null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return variants
    return variants.filter((v) =>
      v.materialName.toLowerCase().includes(q)
      || (v.colourName ?? '').toLowerCase().includes(q)
      || (v.sourceName ?? '').toLowerCase().includes(q)
    )
  }, [variants, query])

  const directionForcesNoRotate = !!selected?.direction?.trim()
  const mayRotate = directionForcesNoRotate ? false : (mayRotateOverride ?? true)

  // No seam_direction input in this sandbox -- no seam_direction column
  // exists on materials/material_variants today. 'both' is the least
  // restrictive value nestMaterial accepts, so a paneled result shows
  // real geometry here instead of an artificial refusal that has nothing
  // to do with what's actually being tested. seam_overlap_width, unlike
  // seam_direction, IS a real, already-existing, already-tested
  // nestMaterial input (tests 10/11) -- just one nothing in the app has
  // ever supplied a non-zero value for, since no product-recipe field
  // exists to source it from yet. Exposing it here doesn't change that;
  // it lets it be run and felt for the first time.
  function buildInput(overlap: number) {
    if (!selected) return null
    const ph = parseFloat(productHeight)
    const pw = parseFloat(productWidth)
    const qty = parseInt(quantity, 10)
    if (!(ph > 0) || !(pw > 0) || !Number.isFinite(qty)) return null
    return {
      stock_height: selected.height != null ? lengthToInches(selected.height, selected.lengthUom) : null,
      stock_width: selected.width,
      fixed_side: selected.fixedSide,
      length_increment: selected.lengthIncrement,
      product_height: ph,
      product_width: pw,
      quantity: qty,
      spacing: 0,
      edge_margin: 0,
      may_rotate: mayRotate,
      seam_overlap_width: overlap,
      seam_direction: 'both' as const,
    }
  }

  const result: NesterOutput | null = useMemo(() => {
    const overlap = parseFloat(seamOverlapWidth)
    const input = buildInput(Number.isFinite(overlap) && overlap > 0 ? overlap : 0)
    return input ? nestMaterial(input) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, productHeight, productWidth, quantity, mayRotate, seamOverlapWidth])

  // The overlap's own effect, isolated: re-run the exact same job with
  // seam_overlap_width forced to 0 and diff consumed_sqft_total against
  // the real result. This measures nestMaterial's ACTUAL behavior rather
  // than re-deriving the overlap formula by hand here -- correct even if
  // that formula ever changes, and it's 0 whenever there's no paneling
  // (seams=0) or no overlap entered, exactly as it should be.
  const overlapExtraSqft = useMemo(() => {
    if (!result || !result.fits || result.seams === 0) return 0
    const withoutOverlapInput = buildInput(0)
    if (!withoutOverlapInput) return 0
    const withoutOverlap = nestMaterial(withoutOverlapInput)
    return Math.max(0, result.consumed_sqft_total - withoutOverlap.consumed_sqft_total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const invariant = selected && result && result.fits ? wholePieceSqft(selected, result) : null
  const invariantSum = result ? result.product_sqft_total + result.offcut_sqft_total + result.remainder_sqft_total : null
  const invariantPasses = invariant != null && invariantSum != null && Math.abs(invariantSum - invariant.value) < 1e-6

  // THE LOCKED PRICING MODEL (do not reinterpret): product is charged at
  // sell_per_unit; offcut ("waste") is charged at cost_per_unit x the
  // material's wastage markup, only when calculate_wastage is on AND a
  // real markup is set; remainder is never charged, it returns to
  // stock. Every "not charged" case still shows the sqft being given
  // away and says WHY in a visible warning -- never a silent 1.0
  // fallback, never a hidden line. Computed from full-precision rate
  // inputs throughout; only the final displayed numbers are rounded.
  const pricing = useMemo(() => {
    if (!selected || !result || !result.fits) return null
    const hasCost = selected.costPerUnit != null
    const hasSell = selected.sellPerUnit != null
    const hasMarkup = selected.wastageMarkup != null && selected.wastageMarkup > 0

    const payAmount = hasCost ? result.consumed_sqft_total * selected.costPerUnit! : null
    const productAmount = hasSell ? result.product_sqft_total * selected.sellPerUnit! : null

    let wasteAmount = 0
    let wasteWarning: string | null = null
    if (!selected.calculateWastage) {
      wasteWarning = 'calculate_wastage is off for this material — waste not charged'
    } else if (!hasMarkup) {
      wasteWarning = 'wastage markup not set — waste not charged'
    } else if (!hasCost) {
      wasteWarning = 'cost_per_unit not set — waste not charged'
    } else {
      wasteAmount = result.offcut_sqft_total * selected.costPerUnit! * selected.wastageMarkup!
    }

    // remainder is always $0 -- a business rule, not a data gap.
    const materialCharged = hasSell ? productAmount! + wasteAmount + 0 : null
    const margin = materialCharged != null && payAmount != null ? materialCharged - payAmount : null

    return { hasCost, hasSell, hasMarkup, payAmount, productAmount, wasteAmount, wasteWarning, materialCharged, margin }
  }, [selected, result])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-6">
      {/* ── Inputs ──────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-bold text-qm-black">Material variant</h2>
            <p className="mt-0.5 text-xs text-qm-gray">Search by family name, colour, or its original ShopVOX name.</p>
          </div>
          <div className="p-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search materials…"
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </div>
          <div className="max-h-80 overflow-y-auto border-t border-gray-100">
            {filtered.length === 0 ? (
              <p className="p-4 text-center text-sm text-qm-gray">No materials match.</p>
            ) : (
              filtered.map((v) => {
                const label = v.colourName ? `${v.materialName} · ${v.colourName}` : v.materialName
                const isSelected = v.id === selectedId
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`block w-full border-b border-gray-100 px-4 py-2 text-left last:border-0 hover:bg-qm-surface ${isSelected ? 'bg-blue-50' : ''}`}
                  >
                    <div className="truncate text-sm font-medium text-qm-black">{label}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-qm-gray">
                      <span>{fmtDim(v.height)} × {fmtDim(v.width)}</span>
                      <span className="text-gray-300">·</span>
                      <span>{v.fixedSide}</span>
                    </div>
                    {v.sourceName && (
                      <div className="mt-0.5 truncate text-[10.5px] text-gray-400" title={v.sourceName}>{v.sourceName}</div>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
          <h2 className="text-sm font-bold text-qm-black">Product</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-qm-gray">Height (in)</span>
              <input
                type="number" min={0} step="0.01" value={productHeight}
                onChange={(e) => setProductHeight(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-qm-gray">Width (in)</span>
              <input
                type="number" min={0} step="0.01" value={productWidth}
                onChange={(e) => setProductWidth(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-qm-gray">Quantity</span>
            <input
              type="number" min={0} step="1" value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-qm-gray">Seam overlap (in)</span>
            <input
              type="number" min={0} step="0.01" value={seamOverlapWidth}
              onChange={(e) => setSeamOverlapWidth(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
            />
            <p className="mt-1 text-xs text-qm-gray">
              Only matters when the product needs paneling (seams &gt; 0). No product-recipe field sources this yet — defaults to 0.
            </p>
          </label>

          <div>
            <label className={`flex items-center gap-2 text-sm ${directionForcesNoRotate ? 'text-qm-gray' : 'text-qm-black'}`}>
              <input
                type="checkbox"
                checked={mayRotate}
                disabled={directionForcesNoRotate}
                onChange={(e) => setMayRotateOverride(e.target.checked)}
                className="accent-qm-lime disabled:cursor-not-allowed"
              />
              May rotate
            </label>
            {directionForcesNoRotate && (
              <p className="mt-1 text-xs text-qm-gray">
                Rotation disabled — this variant has a grain/direction constraint: &ldquo;{selected!.direction}&rdquo;.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Outputs ─────────────────────────────────────────────────── */}
      <div className="space-y-5">
        {!selected ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-qm-gray">
            No material variants available to test.
          </div>
        ) : !result ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-qm-gray">
            Enter a positive product height, width, and quantity to see a result.
          </div>
        ) : (
          <>
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-bold text-qm-black">Nester output</h2>
              </div>
              <dl className="divide-y divide-gray-100">
                {OUTPUT_ROWS.map((row) => (
                  <div key={row.key} className="flex items-center justify-between px-4 py-2 text-sm">
                    <dt className="text-qm-gray">{row.label}</dt>
                    <dd className={`font-mono tabular-nums ${row.key === 'fits' && !result.fits ? 'font-semibold text-red-600' : 'text-qm-black'}`}>
                      {row.format(result)}
                    </dd>
                  </div>
                ))}
                {/* Not a NesterOutput field -- computed here by diffing
                    against the same job with seam_overlap_width forced to
                    0, so the overlap's own contribution is visible as its
                    own line instead of buried inside consumed_sqft_total. */}
                <div className="flex items-center justify-between bg-blue-50 px-4 py-2 text-sm">
                  <dt className="font-medium text-qm-black">Extra from seam overlap (sqft)</dt>
                  <dd className="font-mono tabular-nums font-semibold text-qm-black">{fmtSqft(overlapExtraSqft)}</dd>
                </div>
              </dl>
            </div>

            <div className={`rounded-lg border p-4 ${
              !result.fits ? 'border-gray-200 bg-gray-50'
                : invariantPasses ? 'border-green-200 bg-green-50' : 'border-red-300 bg-red-50'
            }`}>
              <h2 className="text-sm font-bold text-qm-black">Invariant check</h2>
              {!result.fits ? (
                <p className="mt-2 text-sm text-qm-gray">
                  N/A — this product does not fit, so nothing was nested. There is no piece breakdown to check.
                </p>
              ) : (
                <>
                  <p className="mt-2 font-mono text-sm text-qm-black">
                    product ({fmtSqft(result.product_sqft_total)}) + offcut ({fmtSqft(result.offcut_sqft_total)}) + remainder ({fmtSqft(result.remainder_sqft_total)})
                    {' = '}
                    {fmtSqft(invariantSum!)}
                    {' vs. whole piece '}
                    {fmtSqft(invariant!.value)}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${
                      invariantPasses ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                    }`}>
                      {invariantPasses ? 'PASS' : 'FAIL'}
                    </span>
                    {!invariant!.independent && (
                      <span className="text-xs text-qm-gray">
                        self-consistent check — this shape (roll, fixed_side=both/none, or a paneled result) has no independently bounded &ldquo;whole piece&rdquo; size to check against; &ldquo;whole piece&rdquo; here is consumed_sqft_total itself.
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            {pricing && (
              <div className="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-4">
                <h2 className="text-sm font-bold uppercase tracking-wide text-amber-800">Material cost only — no labor, no seam cost, not a quote</h2>

                <h3 className="mt-3 text-[10.5px] font-bold uppercase tracking-wide text-amber-700">What we pay</h3>
                <div className="mt-1 flex items-baseline justify-between gap-3 text-sm text-amber-900">
                  <span>
                    consumed {fmtSqft(result.consumed_sqft_total)} sqft × cost_per_unit{' '}
                    {pricing.hasCost ? <>{fmtRate(selected.costPerUnit!)}</> : <span className="font-semibold text-red-700">not set</span>}
                  </span>
                  <span className="font-mono font-semibold whitespace-nowrap">
                    {pricing.payAmount != null ? fmtMoney(pricing.payAmount) : <span className="text-red-700">— can&apos;t compute</span>}
                  </span>
                </div>

                <h3 className="mt-4 text-[10.5px] font-bold uppercase tracking-wide text-amber-700">What we charge</h3>
                <div className="mt-1 space-y-2 text-sm text-amber-900">
                  {/* product -- sell_per_unit */}
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span>
                        product {fmtSqft(result.product_sqft_total)} sqft × sell_per_unit{' '}
                        {pricing.hasSell ? <>{fmtRate(selected.sellPerUnit!)}</> : <span className="font-semibold text-red-700">not set</span>}
                      </span>
                      <span className="font-mono font-semibold whitespace-nowrap">
                        {pricing.productAmount != null ? fmtMoney(pricing.productAmount) : <span className="text-red-700">— can&apos;t compute</span>}
                      </span>
                    </div>
                    {pricing.hasCost && (
                      <p className="pl-4 text-xs text-amber-700">
                        sell_per_unit = cost_per_unit {fmtRate(selected.costPerUnit!)} × multiplier {fmtRate(selected.multiplier)}
                      </p>
                    )}
                  </div>

                  {/* waste -- offcut x cost_per_unit x wastage markup, or a visible warning */}
                  <div>
                    {pricing.wasteWarning ? (
                      <div className="flex items-baseline justify-between gap-3">
                        <span>
                          waste {fmtSqft(result.offcut_sqft_total)} sqft — <span className="font-semibold text-red-700">{pricing.wasteWarning}</span>
                        </span>
                        <span className="font-mono font-semibold whitespace-nowrap">{fmtMoney(0)}</span>
                      </div>
                    ) : (
                      <div className="flex items-baseline justify-between gap-3">
                        <span>
                          waste {fmtSqft(result.offcut_sqft_total)} sqft × cost_per_unit {fmtRate(selected.costPerUnit!)} × wastage {fmtRate(selected.wastageMarkup!)}
                        </span>
                        <span className="font-mono font-semibold whitespace-nowrap">{fmtMoney(pricing.wasteAmount)}</span>
                      </div>
                    )}
                  </div>

                  {/* remainder -- never charged, a policy, not a data gap */}
                  <div className="flex items-baseline justify-between gap-3">
                    <span>remainder {fmtSqft(result.remainder_sqft_total)} sqft — not charged, returns to stock</span>
                    <span className="font-mono font-semibold whitespace-nowrap">{fmtMoney(0)}</span>
                  </div>

                  <div className="space-y-1 border-t border-amber-300 pt-2">
                    <div className="flex items-baseline justify-between gap-3 font-semibold">
                      <span>material charged</span>
                      <span className="font-mono whitespace-nowrap">
                        {pricing.materialCharged != null ? fmtMoney(pricing.materialCharged) : <span className="text-red-700">— incomplete, see warnings above</span>}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span>margin over material cost</span>
                      <span className="font-mono whitespace-nowrap">
                        {pricing.margin != null ? fmtMoney(pricing.margin) : <span className="text-red-700">— incomplete, see warnings above</span>}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
