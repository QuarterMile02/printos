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
    return { value: out.consumed_sqft, independent: false }
  }
  if (v.height == null || v.width == null) {
    return { value: out.consumed_sqft, independent: false }
  }
  const stockHeightIn = lengthToInches(v.height, v.lengthUom)
  return { value: (stockHeightIn * v.width) / 144, independent: true }
}

const OUTPUT_ROWS: { key: keyof NesterOutput; label: string; format: (out: NesterOutput) => string }[] = [
  { key: 'fits', label: 'Fits', format: (o) => (o.fits ? 'Yes' : 'No') },
  { key: 'reason', label: 'Reason', format: (o) => o.reason ?? '—' },
  { key: 'n_up', label: 'N-up (copies per band/panel)', format: (o) => String(o.n_up) },
  { key: 'rotated', label: 'Rotated', format: (o) => (o.rotated ? 'Yes' : 'No') },
  { key: 'down', label: 'Down (stacked along the fixed axis)', format: (o) => String(o.down) },
  { key: 'across', label: 'Across (bands along the free axis)', format: (o) => String(o.across) },
  { key: 'panels', label: 'Panels', format: (o) => String(o.panels) },
  { key: 'seams', label: 'Seams', format: (o) => String(o.seams) },
  { key: 'seam_length_in', label: 'Seam length (total, inches)', format: (o) => o.seam_length_in.toFixed(2) },
  { key: 'consumed_sqft', label: 'Consumed (sqft)', format: (o) => fmtSqft(o.consumed_sqft) },
  { key: 'product_sqft', label: 'Product (sqft)', format: (o) => fmtSqft(o.product_sqft) },
  { key: 'offcut_sqft', label: 'Offcut (sqft)', format: (o) => fmtSqft(o.offcut_sqft) },
  { key: 'remainder_sqft', label: 'Remainder (sqft)', format: (o) => fmtSqft(o.remainder_sqft) },
]

export default function NestingSandboxClient({ variants }: { variants: VariantOption[] }) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(variants[0]?.id ?? null)
  const [productHeight, setProductHeight] = useState('12')
  const [productWidth, setProductWidth] = useState('12')
  const [quantity, setQuantity] = useState('1')
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

  const result: NesterOutput | null = useMemo(() => {
    if (!selected) return null
    const ph = parseFloat(productHeight)
    const pw = parseFloat(productWidth)
    const qty = parseInt(quantity, 10)
    if (!(ph > 0) || !(pw > 0) || !Number.isFinite(qty)) return null

    return nestMaterial({
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
      // No seam_overlap_width / seam_direction inputs in this sandbox --
      // seam_overlap_width has no product-recipe source yet (kept out of
      // this PR entirely, per instruction), and no seam_direction column
      // exists on materials/material_variants today. 'both' is the least
      // restrictive value nestMaterial accepts, so a paneled result shows
      // real geometry here instead of an artificial refusal that has
      // nothing to do with what's actually being tested.
      seam_overlap_width: 0,
      seam_direction: 'both',
    })
  }, [selected, productHeight, productWidth, quantity, mayRotate])

  const invariant = selected && result && result.fits ? wholePieceSqft(selected, result) : null
  const invariantSum = result ? result.product_sqft + result.offcut_sqft + result.remainder_sqft : null
  const invariantPasses = invariant != null && invariantSum != null && Math.abs(invariantSum - invariant.value) < 1e-6

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
                    product ({fmtSqft(result.product_sqft)}) + offcut ({fmtSqft(result.offcut_sqft)}) + remainder ({fmtSqft(result.remainder_sqft)})
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
                        self-consistent check — this shape (roll, fixed_side=both/none, or a paneled result) has no independently bounded &ldquo;whole piece&rdquo; size to check against; &ldquo;whole piece&rdquo; here is consumed_sqft itself.
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-amber-800">Material cost only — no labor, no seam cost, not a quote</h2>
              {selected.costPerUnit == null && selected.sellPerUnit == null ? (
                <p className="mt-2 text-sm text-amber-800">
                  This variant has no cost_per_unit or sell_per_unit (its sqft is likely NULL, so pricing falls back to base_cost elsewhere) — nothing to multiply here.
                </p>
              ) : (
                <dl className="mt-2 space-y-1 text-sm text-amber-900">
                  <div className="flex justify-between">
                    <dt>{fmtSqft(result.consumed_sqft)} sqft × cost_per_unit ({selected.costPerUnit != null ? fmtMoney(selected.costPerUnit) : 'not set'})</dt>
                    <dd className="font-mono font-semibold">
                      {selected.costPerUnit != null ? fmtMoney(result.consumed_sqft * selected.costPerUnit) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>{fmtSqft(result.consumed_sqft)} sqft × sell_per_unit ({selected.sellPerUnit != null ? fmtMoney(selected.sellPerUnit) : 'not set'})</dt>
                    <dd className="font-mono font-semibold">
                      {selected.sellPerUnit != null ? fmtMoney(result.consumed_sqft * selected.sellPerUnit) : '—'}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
