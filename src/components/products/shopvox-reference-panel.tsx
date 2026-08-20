'use client'

import React, { useState } from 'react'

type Props = {
  shopvoxData: any
  productId: string
  pricingType: string | null
  formula: string | null
}

// Return the first non-null non-empty string among candidates.
function pick(...vals: any[]): string {
  for (const v of vals) {
    if (v != null && v !== '' && v !== null) return String(v)
  }
  return ''
}

function formatDollars(cents: number): string {
  return '$' + (cents / 100).toFixed(2)
}

// ShopVOX doesn't store Width/Height as modifiers -- it synthesizes them at
// quote time from the product's own pricing_type/formula (confirmed live
// against ShopVOX's Configure Pricing screen: Coroplast 4mm- Direct
// Printing's Modifiers list has no Width/Height entries, yet its Check
// Pricing screen renders both as required, driving "Total Area: Sqft").
// This mirrors that: which dimension(s) a given formula needs, synthesized
// as real inputs rather than looked for in the modifiers list.
//
// Catalog survey (2026-08-20, all 253 pricing_type='Formula' products):
// Area (251), Total_Area (1, a single test product -- computed identically
// to Area in formula-engine.ts), Unit (1). No Perimeter/Width/Height/None
// formula currently exists in this catalog -- 'both'/'width'/'height' below
// are implemented per the stated rule and ready for when one shows up, but
// unverified against a real product since none exists to check against.
type DimensionalMode = 'both' | 'width' | 'height' | 'none'
function dimensionalMode(formula: string | null): DimensionalMode {
  switch (formula) {
    case 'Area':
    case 'Total_Area':
    case 'Perimeter':
      return 'both'
    case 'Width':
      return 'width'
    case 'Height':
      return 'height'
    default: // Unit, None, null, or anything unrecognized
      return 'none'
  }
}

type ReferenceBreakdownLine = {
  idx: number
  name: string
  kind: 'Material' | 'LaborRate' | 'MachineRate'
  formula: string
  total_cost_cents: number
  total_sell_cents: number
  inactive: boolean
  inactive_reason: string | null
  rate_found: boolean
}
type ReferencePriceResult = {
  breakdown: ReferenceBreakdownLine[]
  total_cost_cents: number
  total_sell_cents: number
  margin_pct: number
  discount_percent?: number
  discount_type?: string
  warning?: string
  error?: string
}

export default function ShopVOXReferencePanel({ shopvoxData, productId, pricingType, formula }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  function toggle(key: string) {
    setChecked((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const mode = dimensionalMode(formula)
  const [width, setWidth] = useState<string>('')
  const [height, setHeight] = useState<string>('')
  const [quantity, setQuantity] = useState('1')
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [priceResult, setPriceResult] = useState<ReferencePriceResult | null>(null)

  const needsWidth = mode === 'both' || mode === 'width'
  const needsHeight = mode === 'both' || mode === 'height'
  const widthMissing = needsWidth && (!width.trim() || Number(width) <= 0)
  const heightMissing = needsHeight && (!height.trim() || Number(height) <= 0)

  async function handleCheckReferencePrice() {
    setCheckError(null)
    if (widthMissing || heightMissing) {
      setCheckError('Width and Height are required for this formula — enter both before checking.')
      return
    }
    setChecking(true)
    setPriceResult(null)
    try {
      const res = await fetch('/api/pricing/shopvox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: productId,
          width_inches: needsWidth ? Number(width) : 0,
          height_inches: needsHeight ? Number(height) : 0,
          quantity: Math.max(1, parseInt(quantity, 10) || 1),
        }),
      })
      const data = (await res.json()) as ReferencePriceResult
      if (!res.ok || data.error) {
        setCheckError(data.error ?? 'Reference pricing request failed')
      } else {
        setPriceResult(data)
      }
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : 'Reference pricing request failed')
    } finally {
      setChecking(false)
    }
  }

  if (!shopvoxData || (!shopvoxData.basic && !shopvoxData.modifiers && !shopvoxData.default_items)) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400 italic">
        No ShopVOX data scraped yet for this product.
      </div>
    )
  }

  const basic = shopvoxData.basic ?? {}
  const pricing = shopvoxData.pricing ?? {}
  const modifiers: any[] = shopvoxData.modifiers ?? []
  const dropdownMenus: any[] = shopvoxData.dropdown_menus ?? []
  const defaultItems: any[] = shopvoxData.default_items ?? []
  const deepScrapedAt: string | undefined = shopvoxData.deep_scraped_at

  // Section 1 — Basic Info: [key, label, value]
  const basicRows: [string, string, string][] = (
    [
      ['basic_Type', 'Type', basic.type],
      ['basic_Category', 'Category', basic.category],
      ['basic_Workflow', 'Workflow', basic.workflow],
      ['basic_Display', 'Display Name', basic.display_name],
      ['basic_Secondary', 'Secondary Cat.', basic.secondary_category],
    ] as [string, string, any][]
  ).filter(([, , v]) => v != null && v !== '')
   .map(([k, l, v]): [string, string, string] => [k, l, String(v)])

  // Section 2 — Pricing
  const pricingRows: [string, string, string][] = (
    [
      ['pricing_formula', 'Formula', pricing.formula],
      ['pricing_units', 'Buying Units', pricing.buying_units],
      ['pricing_type', 'Pricing Type', pricing.pricing_type],
      ['pricing_method', 'Method', pricing.pricing_method],
      ['pricing_discount', 'Range Discount', pricing.range_discount],
    ] as [string, string, any][]
  ).filter(([, , v]) => v != null && v !== '')
   .map(([k, l, v]): [string, string, string] => [k, l, String(v)])

  return (
    <div className="text-xs space-y-4">
      {/* Header badge */}
      <div className="space-y-0.5">
        {basic.name && (
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 font-medium">
            ShopVOX: {basic.name}
          </span>
        )}
        {deepScrapedAt && (
          <p className="text-[10px] text-gray-400">
            Scraped {new Date(deepScrapedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {/* Section 1: Basic Info */}
      {basicRows.length > 0 && (
        <div>
          <SectionHeader title="Basic Info" />
          <table className="w-full">
            <tbody>
              {basicRows.map(([key, label, val], i) => {
                const isDone = !!checked[key]
                return (
                  <tr key={key} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1 pl-0.5 w-4 align-middle">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                        className="w-3 h-3 accent-green-500 cursor-pointer" />
                    </td>
                    <td className={`py-1 pr-2 font-medium whitespace-nowrap w-1/3 ${isDone ? 'line-through text-gray-400' : 'text-gray-500'}`}>{label}</td>
                    <td className={`py-1 break-words ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{val}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Section 2: Pricing */}
      {pricingRows.length > 0 && (
        <div>
          <SectionHeader title="Pricing" />
          <table className="w-full">
            <tbody>
              {pricingRows.map(([key, label, val], i) => {
                const isDone = !!checked[key]
                return (
                  <tr key={key} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1 pl-0.5 w-4 align-middle">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                        className="w-3 h-3 accent-green-500 cursor-pointer" />
                    </td>
                    <td className={`py-1 pr-2 font-medium whitespace-nowrap w-1/3 ${isDone ? 'line-through text-gray-400' : 'text-gray-500'}`}>{label}</td>
                    <td className={`py-1 break-words ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{val}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Section 2b: Reference Price Check — synthesized Width/Height,
          exactly as ShopVOX does (they're not in the Modifiers list below,
          they're driven by pricing_type/formula above). Only shown for
          pricing_type='Formula' -- that's the entire population this
          per-item-formula pricing model applies to. */}
      {pricingType === 'Formula' && (
        <div>
          <SectionHeader title="Check Reference Price" />
          <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-2">
            <div className="grid grid-cols-3 gap-2">
              {needsWidth && (
                <div>
                  <label className="block text-[10px] font-medium text-gray-500">
                    Width (in) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number" step="0.01" min={0} value={width}
                    onChange={(e) => setWidth(e.target.value)}
                    className={`mt-0.5 block w-full rounded border px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-qm-lime ${widthMissing && checkError ? 'border-red-300' : 'border-gray-300'}`}
                  />
                </div>
              )}
              {needsHeight && (
                <div>
                  <label className="block text-[10px] font-medium text-gray-500">
                    Height (in) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number" step="0.01" min={0} value={height}
                    onChange={(e) => setHeight(e.target.value)}
                    className={`mt-0.5 block w-full rounded border px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-qm-lime ${heightMissing && checkError ? 'border-red-300' : 'border-gray-300'}`}
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-medium text-gray-500">Qty</label>
                <input
                  type="number" step="1" min={1} value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="mt-0.5 block w-full rounded border border-gray-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-qm-lime"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleCheckReferencePrice}
              disabled={checking}
              className="w-full rounded bg-qm-lime px-2 py-1.5 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              {checking ? 'Checking…' : 'Check Reference Price'}
            </button>

            {checkError && <p className="text-[11px] text-red-600">{checkError}</p>}

            {priceResult && (
              <div className="space-y-1 border-t border-gray-200 pt-2">
                {priceResult.warning && (
                  <p className="text-[11px] text-amber-600 italic">{priceResult.warning}</p>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-gray-500">Total cost</span>
                  <span className="tabular-nums text-gray-700">{formatDollars(priceResult.total_cost_cents)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span className="text-gray-700">Total sell</span>
                  <span className="tabular-nums text-gray-900">{formatDollars(priceResult.total_sell_cents)}</span>
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Margin</span>
                  <span className="tabular-nums">{priceResult.margin_pct.toFixed(1)}%</span>
                </div>
                {priceResult.discount_percent ? (
                  <p className="text-[10px] text-gray-400">
                    {priceResult.discount_type} discount applied: {priceResult.discount_percent}%
                  </p>
                ) : null}
                {priceResult.breakdown.length > 0 && (
                  <table className="w-full mt-1">
                    <tbody>
                      {priceResult.breakdown.map((b) => (
                        <tr key={b.idx} className={b.inactive ? 'opacity-40' : ''}>
                          <td className="py-0.5 pr-1 text-[10px] text-gray-600 truncate max-w-[120px]" title={b.name}>
                            {b.name}{!b.rate_found && <span className="text-amber-500"> (no rate match)</span>}
                          </td>
                          <td className="py-0.5 pr-1 text-[10px] text-gray-400 font-mono">{b.formula}</td>
                          <td className="py-0.5 text-right text-[10px] tabular-nums text-gray-700">
                            {formatDollars(b.total_sell_cents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 3: Modifiers */}
      <div>
        <SectionHeader title="Modifiers" count={modifiers.length} />
        {modifiers.length === 0 ? (
          <p className="text-gray-400 italic py-1">No modifiers.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-gray-400">
                <th className="w-4" />
                <th className="text-left py-1 font-medium">Name</th>
                <th className="text-left py-1 font-medium">Type</th>
                <th className="text-left py-1 font-medium">Default</th>
                <th className="text-left py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {modifiers.map((m, i) => {
                const key = `modifier_${i}`
                const isDone = !!checked[key]
                const mName = m?.Name ?? m?.name ?? m?.attribute ?? m?.Attribute ?? ''
                const mType = m?.Type ?? m?.type ?? ''
                const mDefault = m?.DefaultValue ?? m?.defaultValue ?? m?.default_value ?? m?.Default ?? m?.default ?? ''
                const mOptional = m?.optional === true || m?.optional === 'true' || m?.Optional === true
                const mDefaultStr = String(mDefault)
                const defDisplay = mDefaultStr.length > 20 ? mDefaultStr.slice(0, 20) + '…' : mDefaultStr
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1 pl-0.5 w-4 align-middle">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                        className="w-3 h-3 accent-green-500 cursor-pointer" />
                    </td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{mName}</td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-600'}`}>{mType}</td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-500'}`} title={mDefaultStr}>{defDisplay}</td>
                    <td className="py-1">
                      {mOptional && (
                        <span className="inline-flex rounded-full bg-green-100 text-green-700 px-1.5 py-0.5 text-[10px] font-medium">
                          Optional
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Section 4: Dropdown Menus */}
      <div>
        <SectionHeader title="Dropdown Menus" count={dropdownMenus.length} />
        {dropdownMenus.length === 0 ? (
          <p className="text-gray-400 italic py-1">No dropdown menus.</p>
        ) : (
          <div className="space-y-3">
            {dropdownMenus.map((dm, i) => {
              const key = `dropdown_${i}`
              const isDone = !!checked[key]
              const menuName = pick(dm.menu_name, dm['Menu Name'], dm.name, dm.Name)
              const items: string[] = dm.selected_items ?? dm.items ?? []
              return (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-1">
                    <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                      className="w-3 h-3 accent-green-500 cursor-pointer shrink-0" />
                    <span className={`font-bold ${isDone ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                      {menuName}
                    </span>
                  </div>
                  {items.length === 0 ? (
                    <p className="text-gray-400 italic pl-5">No items selected.</p>
                  ) : (
                    <div className={`flex flex-wrap gap-1 pl-5 ${isDone ? 'opacity-40' : ''}`}>
                      {items.map((item, j) => (
                        <span key={j} className="inline-flex bg-gray-100 text-gray-600 rounded px-2 py-0.5 text-xs">
                          {item}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Section 5: Default Items */}
      <div>
        <SectionHeader title="Default Items" count={defaultItems.length} />
        {defaultItems.length === 0 ? (
          <p className="text-gray-400 italic py-1">No default items.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-gray-400">
                <th className="w-4" />
                <th className="text-left py-1 font-medium">Name</th>
                <th className="text-left py-1 font-medium">Type</th>
                <th className="text-left py-1 font-medium">Formula</th>
                <th className="text-left py-1 font-medium">Mult.</th>
                <th className="text-center py-1 font-medium">Per LI</th>
                <th className="text-left py-1 font-medium">Fixed</th>
                <th className="text-left py-1 font-medium">Mods</th>
              </tr>
            </thead>
            <tbody>
              {defaultItems.map((d, i) => {
                const key = `defaultitem_${i}`
                const isDone = !!checked[key]
                const dName = d?.Name ?? d?.name ?? ''
                const dType = d?.['Item Type'] ?? d?.item_type ?? d?.ItemType ?? d?.Type ?? d?.type ?? ''
                const dFormula = d?.formula ?? d?.Formula ?? ''
                const dMult = d?.multiplier ?? d?.Multiplier ?? ''
                const dNumMod = d?.attach_num_modifier ?? d?.num_modifier ?? ''
                const dChkMod = d?.attach_chk_modifier ?? d?.chk_modifier ?? ''
                const dPerLi: boolean = !!(d?.per_li_unit ?? d?.per_li ?? false)
                const dFixedSide: string = (() => {
                  const fs = d?.fixed_side ?? d?.fixedSide ?? null
                  if (fs === 'width') return 'W'
                  if (fs === 'height') return 'H'
                  if (fs === 'both') return 'Both'
                  return '—'
                })()
                const dFormulaStr = String(dFormula)
                const formulaDisplay = dFormulaStr.length > 18 ? dFormulaStr.slice(0, 18) + '…' : dFormulaStr
                const typeStr = String(dType).toLowerCase().replace('_', '')
                return (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="py-1 pl-0.5 w-4 align-middle">
                      <input type="checkbox" checked={isDone} onChange={() => toggle(key)}
                        className="w-3 h-3 accent-green-500 cursor-pointer" />
                    </td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{dName}</td>
                    <td className="py-1 pr-2">
                      <ItemTypeBadge type={String(dType)} />
                    </td>
                    <td className={`py-1 pr-2 font-mono ${isDone ? 'line-through text-gray-400' : 'text-gray-600'}`} title={dFormulaStr}>{formulaDisplay}</td>
                    <td className={`py-1 pr-2 ${isDone ? 'line-through text-gray-400' : 'text-gray-600'}`}>{dMult !== '' && dMult != null ? String(dMult) : ''}</td>
                    <td className="py-1 text-center text-[10px]">
                      <span className={dPerLi ? 'text-green-600' : 'text-gray-300'}>{dPerLi ? '✓' : '✗'}</span>
                    </td>
                    <td className={`py-1 pr-2 text-[10px] ${isDone ? 'text-gray-300' : 'text-gray-500'}`}>
                      {typeStr === 'material' ? dFixedSide : ''}
                    </td>
                    <td className="py-1 text-[10px] text-gray-500 space-y-0.5">
                      {dNumMod && <span className="block">× {dNumMod}</span>}
                      {dChkMod && <span className="block">✓ {dChkMod}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-200 pb-1 mb-2">
      <span className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">{title}</span>
      {count !== undefined && (
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400 font-medium">
          ({count})
        </span>
      )}
    </div>
  )
}

function ItemTypeBadge({ type }: { type: string }) {
  const t = (type ?? '').toLowerCase().replace('_', '')
  if (t === 'material')
    return <span className="inline-flex rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">Material</span>
  if (t === 'laborrate' || t === 'labor')
    return <span className="inline-flex rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">LaborRate</span>
  if (t === 'machinerate' || t === 'machine')
    return <span className="inline-flex rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 text-[10px] font-medium">MachineRate</span>
  return <span className="text-gray-500 text-[10px]">{type}</span>
}
