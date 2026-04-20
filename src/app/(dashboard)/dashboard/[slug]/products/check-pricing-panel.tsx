'use client'

import { useState } from 'react'

type Breakdown = {
  name: string
  item_type: string
  formula: string
  cost_cents: number
  price_cents: number
  in_base: boolean
}

type PricingResult = {
  unit_price_cents: number
  total_price_cents: number
  breakdown: Breakdown[]
  original_unit_price_cents?: number
  discount_percent?: number
  discount_type?: string
  error?: string
}

function formatDollars(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

export default function CheckPricingPanel({ productId }: { productId: string }) {
  const [width, setWidth] = useState<number>(24)
  const [height, setHeight] = useState<number>(36)
  const [quantity, setQuantity] = useState<number>(1)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PricingResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCalculate() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          width_inches: width,
          height_inches: height,
          quantity,
        }),
      })
      const data = (await res.json()) as PricingResult
      if (!res.ok || data.error) {
        setError(data.error ?? 'Pricing request failed')
      } else {
        setResult(data)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Pricing request failed')
    } finally {
      setLoading(false)
    }
  }

  const totalCostCents = result?.breakdown.reduce((sum, b) => sum + b.cost_cents, 0) ?? 0
  const totalSellCents = result?.unit_price_cents ?? 0
  const margin = totalSellCents > 0 ? ((totalSellCents - totalCostCents) / totalSellCents) * 100 : 0

  return (
    <div className="border-t border-gray-200 pt-6 space-y-4">
      <div>
        <h2 className="text-base font-bold text-qm-black">Check Pricing</h2>
        <p className="text-xs text-qm-gray mt-0.5">
          Test this product&apos;s recipe with real dimensions. Calls the live pricing engine.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 max-w-2xl">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Width (inches)</label>
          <input
            type="number"
            step="0.01"
            min={0}
            value={width}
            onChange={(e) => setWidth(parseFloat(e.target.value) || 0)}
            className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Height (inches)</label>
          <input
            type="number"
            step="0.01"
            min={0}
            value={height}
            onChange={(e) => setHeight(parseFloat(e.target.value) || 0)}
            className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
          <input
            type="number"
            step="1"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
            className="block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-qm-lime focus:outline-none focus:ring-1 focus:ring-qm-lime"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleCalculate}
            disabled={loading}
            className="inline-flex w-full items-center justify-center rounded-md bg-qm-lime px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {loading ? 'Calculating…' : 'Calculate'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          {result.breakdown.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-qm-gray">
              No recipe items — add Materials, Labor, or Machine rates above.
            </p>
          ) : (
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Item</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">Formula</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Cost</th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-gray-500">Sell</th>
                  <th className="px-3 py-2 text-center text-xs font-medium uppercase tracking-wide text-gray-500">In Base</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.breakdown.map((b, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium text-qm-black">{b.name}</td>
                    <td className="px-3 py-2 text-qm-gray">{b.item_type}</td>
                    <td className="px-3 py-2 text-qm-gray">{b.formula}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDollars(b.cost_cents)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatDollars(b.price_cents)}</td>
                    <td className="px-3 py-2 text-center">{b.in_base ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr className="text-xs font-semibold uppercase text-qm-gray">
                  <td className="px-3 py-2" colSpan={3}>Totals (per unit)</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDollars(totalCostCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDollars(totalSellCents)}</td>
                  <td className="px-3 py-2 text-center">Margin</td>
                </tr>
                <tr className="text-sm font-bold text-qm-black">
                  <td className="px-3 py-2" colSpan={3}>Total × {quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">—</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDollars(result.total_price_cents)}</td>
                  <td className="px-3 py-2 text-center text-qm-lime-dark">{margin.toFixed(1)}%</td>
                </tr>
                {result.discount_percent && result.discount_percent > 0 && (
                  <tr className="text-xs text-qm-gray">
                    <td className="px-3 py-2" colSpan={6}>
                      {result.discount_type} discount applied: {result.discount_percent}%
                      {result.original_unit_price_cents != null && (
                        <> (was {formatDollars(result.original_unit_price_cents)} / unit)</>
                      )}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
