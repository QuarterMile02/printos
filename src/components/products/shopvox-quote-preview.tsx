'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

// This is where a real price gets calculated, the way ShopVOX does it --
// through the REAL PrintOS pricing path (calculateProductPrice(), same
// function every actual quote line item goes through), not a parallel
// reimplementation. The old version of this component computed its own
// price client-side straight from the raw shopvox_data scrape; that's
// gone. The Migrate page's reference panel (left, "reference" tab) is a
// read-only ShopVOX mirror and does not price anything -- this tab is the
// only place pricing happens now. See
// known-issues/2026-08-21-quote-preview-real-pricing.md.

export type QuoteModifierInput = {
  id: string
  system_lookup_name: string | null
  display_name: string
  modifier_type: string // 'Boolean' | 'Numeric' | ... (treated as numeric unless Boolean)
  default_value: string | null
}

type Props = {
  productId: string
  productModifiers: QuoteModifierInput[]
}

type LineBreakdown = {
  name: string
  item_type: string
  formula: string
  cost_cents: number
  price_cents: number
  in_base: boolean
  inactive?: boolean
  inactive_reason?: string
}
type PricingResult = {
  unit_price_cents: number
  total_price_cents: number
  breakdown: LineBreakdown[]
  original_unit_price_cents?: number
  discount_percent?: number
  discount_type?: string
  error?: string
}

function fmt(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

function keyFor(m: QuoteModifierInput): string {
  return m.system_lookup_name ?? m.id
}

function seedValue(m: QuoteModifierInput): boolean | number {
  const raw = (m.default_value ?? '').trim().toLowerCase()
  if (m.modifier_type === 'Boolean') {
    return raw === 'true' || raw === 'yes' || raw === '1'
  }
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

export default function ShopvoxQuotePreview({ productId, productModifiers }: Props) {
  const [width, setWidth] = useState('48')
  const [height, setHeight] = useState('96')
  const [qty, setQty] = useState('1')
  const [modVals, setModVals] = useState<Record<string, boolean | number>>(() => {
    const init: Record<string, boolean | number> = {}
    for (const m of productModifiers) init[keyFor(m)] = seedValue(m)
    return init
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PricingResult | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const calculate = useCallback(async () => {
    const w = parseFloat(width) || 0
    const h = parseFloat(height) || 0
    const q = Math.max(1, parseInt(qty, 10) || 1)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          width_inches: w,
          height_inches: h,
          quantity: q,
          selected_modifiers: modVals,
        }),
      })
      const data = (await res.json()) as PricingResult
      if (!res.ok || data.error) {
        setError(data.error ?? 'Pricing request failed')
        setResult(null)
      } else {
        setResult(data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pricing request failed')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [productId, width, height, qty, modVals])

  // Debounced auto-recalculate whenever an input changes, same UX as before.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { calculate() }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [calculate])

  const byKind = { Material: 0, LaborRate: 0, MachineRate: 0, CustomItem: 0, Modifier: 0 } as Record<string, number>
  let totalCostCents = 0
  for (const b of result?.breakdown ?? []) {
    if (b.inactive) continue
    totalCostCents += b.cost_cents
    byKind[b.item_type] = (byKind[b.item_type] ?? 0) + b.cost_cents
  }
  const unitPriceCents = result?.unit_price_cents ?? 0
  const markupCents = unitPriceCents - totalCostCents
  const marginPct = unitPriceCents > 0 ? ((unitPriceCents - totalCostCents) / unitPriceCents) * 100 : 0

  const boolMods = productModifiers.filter(m => m.modifier_type === 'Boolean')
  const numMods = productModifiers.filter(m => m.modifier_type !== 'Boolean')

  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Quote Preview</p>
        <p className="text-[10px] text-gray-400 italic">Prices through the real PrintOS pricing engine, the way a quote line item would.</p>
      </div>

      {/* Width / Height / Qty */}
      <div className="rounded-lg border border-gray-200 bg-white p-2">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[10px] font-medium text-gray-500">Width (in)</label>
            <input type="number" step="0.01" min={0} value={width} onChange={(e) => setWidth(e.target.value)}
              className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-qm-lime" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500">Height (in)</label>
            <input type="number" step="0.01" min={0} value={height} onChange={(e) => setHeight(e.target.value)}
              className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-qm-lime" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-gray-500">Qty</label>
            <input type="number" step="1" min={1} value={qty} onChange={(e) => setQty(e.target.value)}
              className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-qm-lime" />
          </div>
        </div>
      </div>

      {/* Numeric modifiers -- real product_modifiers, seeded from their Default */}
      {numMods.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Modifiers ({productModifiers.length})</p>
          <div className="grid grid-cols-3 gap-2">
            {numMods.map(m => (
              <div key={m.id}>
                <label className="block truncate text-[10px] text-gray-500 mb-0.5" title={m.display_name}>{m.display_name}</label>
                <input
                  type="number" step="any"
                  value={String(modVals[keyFor(m)] ?? 0)}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value)
                    setModVals(p => ({ ...p, [keyFor(m)]: Number.isFinite(parsed) ? parsed : 0 }))
                  }}
                  className="w-full rounded border border-gray-300 px-1.5 py-1 text-xs"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Boolean modifiers */}
      {boolMods.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Options</p>
          {boolMods.map(m => (
            <label key={m.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
              <input
                type="checkbox"
                checked={!!modVals[keyFor(m)]}
                onChange={(e) => setModVals(p => ({ ...p, [keyFor(m)]: e.target.checked }))}
                className="h-3 w-3 accent-green-500"
              />
              <span className="text-xs text-gray-700">{m.display_name}</span>
            </label>
          ))}
        </div>
      )}

      {productModifiers.length === 0 && (
        <p className="text-[10px] text-gray-400 italic">No modifiers on this product&apos;s recipe yet.</p>
      )}

      {error && <p className="text-red-600">{error}</p>}
      {loading && (
        <div className="flex items-center gap-2 text-gray-400 py-1">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" />
          Calculating…
        </div>
      )}

      {/* Breakdown -- material / labor / machine / markup, so a wrong
          number is diagnosable, not just a single total. */}
      {result && (
        <div className="space-y-2">
          <div className="rounded-lg border border-gray-200 bg-white p-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Cost by category</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Material</span><span className="tabular-nums">{fmt(byKind.Material)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Labor</span><span className="tabular-nums">{fmt(byKind.LaborRate)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Machine</span><span className="tabular-nums">{fmt(byKind.MachineRate)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Markup</span><span className="tabular-nums">{fmt(markupCents)}</span></div>
              {byKind.CustomItem > 0 && <div className="flex justify-between"><span className="text-gray-500">Custom</span><span className="tabular-nums">{fmt(byKind.CustomItem)}</span></div>}
              {byKind.Modifier > 0 && <div className="flex justify-between"><span className="text-gray-500">Modifiers</span><span className="tabular-nums">{fmt(byKind.Modifier)}</span></div>}
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500">Name</th>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500">Type</th>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500">Formula</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Cost</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Sell</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.breakdown.map((b, i) => (
                  <tr key={i} className={b.inactive ? 'opacity-40' : ''}>
                    <td className="px-2 py-1.5 max-w-[160px] truncate" title={b.name}>{b.name}</td>
                    <td className="px-2 py-1.5 text-gray-500">{b.item_type}</td>
                    <td className="px-2 py-1.5 text-gray-500 font-mono">{b.formula}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.cost_cents)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.price_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.discount_percent ? (
            <p className="text-[10px] text-gray-400">
              {result.discount_type} discount applied: {result.discount_percent}%
              {result.original_unit_price_cents != null && <> (was {fmt(result.original_unit_price_cents)}/unit)</>}
            </p>
          ) : null}
        </div>
      )}

      {/* Sticky totals bar */}
      <div className="sticky bottom-0 bg-white border-t-2 border-green-500 p-3 flex flex-wrap gap-4 items-center z-10 shadow-md">
        <span className="text-gray-600 text-xs">
          Cost: <span className="font-semibold tabular-nums">{result ? fmt(totalCostCents) : '—'}</span>
        </span>
        <span className="text-xs font-bold" style={{ color: '#93ca3b' }}>
          Sell (per unit): <span className="tabular-nums">{result ? fmt(unitPriceCents) : '—'}</span>
        </span>
        <span className="text-xs font-semibold text-gray-700">
          Margin: <span className="tabular-nums">{result ? `${marginPct.toFixed(1)}%` : '—'}</span>
        </span>
        {result && parseInt(qty, 10) > 1 && (
          <span className="text-gray-500 text-xs">Total × {qty}: {fmt(result.total_price_cents)}</span>
        )}
      </div>
    </div>
  )
}
