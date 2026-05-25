'use client'

import React, { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { computeLineItem, computeMaterialLineItem, type RateRecord } from '@/lib/pricing/compute-line-item'

interface Props {
  shopvoxData: any
  productName: string
  orgSlug: string
}

type RateRow = {
  name: string
  cost: number
  price: number
  markup: number
  production_rate: number | null
  setup_charge: number | null
  other_charge: number | null
}
type RateMap = Record<string, RateRow>

type FullMaterialRow = {
  name: string
  cost: number
  price: number
  formula: string | null
  fixed_side: string | null
  width: number | null
  height: number | null
  wastage_markup: number | null
  calculate_wastage: boolean | null
}
type FullMaterialMap = Record<string, FullMaterialRow>

interface LineResult {
  name: string
  itemType: string
  formula: string
  displayQty: number
  unitCost: number
  unitPrice: number
  totalCost: number
  totalPrice: number
  active: boolean
  rateFound: boolean
  isMaterial: boolean
  breakdown?: string[]
}

function fmt(n: number) {
  return '$' + n.toFixed(2)
}

function computeFormula(formula: string, widthFt: number, heightFt: number): number {
  const f = (formula ?? '').toLowerCase().trim()
  if (f === 'area' || f.includes('area')) return widthFt * heightFt
  if (f === 'perimeter' || f.includes('perim')) return 2 * (widthFt + heightFt)
  if (f === 'height') return heightFt
  if (f === 'width') return widthFt
  return 1
}

function buildRateMap(rows: any[]): RateMap {
  const m: RateMap = {}
  for (const r of rows ?? []) {
    if (r?.name) {
      m[r.name.trim().toLowerCase()] = {
        name: r.name,
        cost: r.cost ?? 0,
        price: r.price ?? (r.cost ?? 0) * (r.markup ?? 1),
        markup: r.markup ?? 1,
        production_rate: r.production_rate ?? null,
        setup_charge: r.setup_charge ?? null,
        other_charge: r.other_charge ?? null,
      }
    }
  }
  return m
}

function normalize(s: string) {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Prefix/contains match so "Ink Epson GS3" finds "Ink Epson GS3 Printing"
function findMaterial(map: FullMaterialMap, name: string): FullMaterialRow | undefined {
  const key = name.trim().toLowerCase()
  if (map[key]) return map[key]
  for (const [k, val] of Object.entries(map)) {
    if (k.startsWith(key) || key.startsWith(k)) return val
  }
}

// Safe formula evaluator: replaces modifier variable names with their current values
// then evaluates the expression string. Handles ternary, arithmetic, boolean.
// e.g. "Grommets_Corners ? 4 : No_Grommets ? 0 : (2*(Width+Height))/Grommets_Spacing"
function evalExpression(expr: string, vars: Record<string, any>): number {
  let s = expr
  // Sort longer names first to avoid partial replacements (e.g. "Width" before "W")
  const names = Object.keys(vars).sort((a, b) => b.length - a.length)
  for (const name of names) {
    const v = vars[name]
    const replacement = typeof v === 'boolean' ? String(v) : String(parseFloat(String(v)) || 0)
    s = s.replace(new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), replacement)
  }
  try {
    // eslint-disable-next-line no-new-func
    const r = new Function(`"use strict"; return (${s})`)()
    return typeof r === 'number' && isFinite(r) ? r : 0
  } catch {
    return 0
  }
}

function TypeBadge({ type }: { type: string }) {
  const t = (type ?? '').toLowerCase().replace('_', '')
  if (t === 'material')
    return <span className="inline-flex rounded-full bg-blue-100 text-blue-700 px-1.5 py-0.5 text-[10px] font-medium">Material</span>
  if (t === 'laborrate' || t === 'labor')
    return <span className="inline-flex rounded-full bg-purple-100 text-purple-700 px-1.5 py-0.5 text-[10px] font-medium">Labor</span>
  if (t === 'machinerate' || t === 'machine')
    return <span className="inline-flex rounded-full bg-orange-100 text-orange-700 px-1.5 py-0.5 text-[10px] font-medium">Machine</span>
  return <span className="text-[10px] text-gray-500">{type}</span>
}

export default function ShopvoxQuotePreview({ shopvoxData, productName, orgSlug }: Props) {
  const modifiers: any[] = shopvoxData?.modifiers ?? []
  const dropdownMenus: any[] = shopvoxData?.dropdown_menus ?? []
  const defaultItems: any[] = shopvoxData?.default_items ?? []

  // ── state ─────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [width] = useState(48)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [height] = useState(96)
  const [qty, setQty] = useState(1)
  const [modVals, setModVals] = useState<Record<string, any>>({})
  const [dropdownVals, setDropdownVals] = useState<Record<string, string>>({})

  const [ratesLoading, setRatesLoading] = useState(true)
  const [ratesError, setRatesError] = useState<string | null>(null)
  const [ratesReady, setRatesReady] = useState(false)
  const [laborMap, setLaborMap] = useState<RateMap>({})
  const [machineMap, setMachineMap] = useState<RateMap>({})
  const [fullMaterialMap, setFullMaterialMap] = useState<FullMaterialMap>({})

  const [results, setResults] = useState<LineResult[] | null>(null)
  const [grandTotalCost, setGrandTotalCost] = useState(0)
  const [grandTotalPrice, setGrandTotalPrice] = useState(0)

  // ── initialize modifier defaults ──────────────────────────────
  useEffect(() => {
    const init: Record<string, any> = {}
    for (const m of modifiers) {
      const name = m?.name ?? m?.Name ?? ''
      if (!name) continue
      const type = (m?.type ?? m?.Type ?? '').toLowerCase()
      const defVal = m?.defaultValue ?? m?.DefaultValue ?? m?.default_value ?? m?.default ?? ''
      if (type === 'boolean' || type === 'checkbox') {
        init[name] = defVal === 'true' || defVal === 'on' || defVal === true
      } else {
        const parsed = parseFloat(String(defVal))
        init[name] = isNaN(parsed) ? 0 : parsed
      }
    }
    if (init['Height'] === undefined) init['Height'] = 96
    if (init['Width'] === undefined) init['Width'] = 48
    setModVals(init)

    const ddInit: Record<string, string> = {}
    for (const dm of dropdownMenus) {
      const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
      const items: string[] = dm?.selected_items ?? []
      if (menuName) {
        ddInit[menuName] = dm?.optional ? '' : (items[0] ?? '')
      }
    }
    setDropdownVals(ddInit)
  }, [shopvoxData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── fetch rates on mount ──────────────────────────────────────
  useEffect(() => {
    if (!orgSlug) return
    let cancelled = false
    async function load() {
      setRatesLoading(true)
      setRatesError(null)
      try {
        const supabase = createClient()
        const { data: orgRow, error: orgErr } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', orgSlug)
          .limit(1)
          .maybeSingle()
        if (orgErr || !orgRow) throw new Error('Organization not found')
        const orgId = (orgRow as { id: string }).id

        const [laborRes, machineRes, matRes] = await Promise.all([
          supabase.from('labor_rates').select('name, cost, price, markup, production_rate, setup_charge, other_charge').eq('organization_id', orgId).eq('active', true),
          supabase.from('machine_rates').select('name, cost, price, markup, production_rate, setup_charge, other_charge').eq('organization_id', orgId).eq('active', true),
          supabase.from('materials').select('name, cost, price, markup, formula, fixed_side, width, height, wastage_markup, calculate_wastage').eq('organization_id', orgId).eq('active', true),
        ])

        if (!cancelled) {
          setLaborMap(buildRateMap(laborRes.data ?? []))
          setMachineMap(buildRateMap(machineRes.data ?? []))
          const matData: FullMaterialMap = {}
          for (const r of (matRes.data ?? []) as any[]) {
            if (r?.name) matData[r.name.trim().toLowerCase()] = {
              name: r.name, cost: r.cost ?? 0,
              price: r.price ?? (r.cost ?? 0) * (r.markup ?? 1),
              formula: r.formula ?? null, fixed_side: r.fixed_side ?? null,
              width: r.width ?? null, height: r.height ?? null,
              wastage_markup: r.wastage_markup ?? null, calculate_wastage: r.calculate_wastage ?? null,
            }
          }
          setFullMaterialMap(matData)
          setRatesReady(true)
        }
      } catch (e) {
        if (!cancelled) setRatesError(e instanceof Error ? e.message : 'Failed to load rates')
      } finally {
        if (!cancelled) setRatesLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [orgSlug])

  // ── calculate ─────────────────────────────────────────────────
  function handleCalculate() {
    if (!ratesReady) return

    const widthInches  = parseFloat(String(modVals['Width']  ?? modVals['width']  ?? 48)) || 48
    const heightInches = parseFloat(String(modVals['Height'] ?? modVals['height'] ?? 96)) || 96
    const widthFt  = widthInches / 12
    const heightFt = heightInches / 12
    const q = Math.max(1, qty)

    const lines: LineResult[] = []

    for (const d of defaultItems) {
      const name = d?.name ?? d?.Name ?? ''
      const rawType = d?.item_type ?? d?.['Item Type'] ?? d?.ItemType ?? d?.type ?? ''
      const itemFormula = d?.formula ?? d?.Formula ?? 'Unit'
      const multiplier = parseFloat(String(d?.multiplier ?? d?.Multiplier ?? '1')) || 1
      const attachNum: string = d?.attach_num_modifier ?? d?.num_modifier ?? ''
      const attachChk: string = d?.attach_chk_modifier ?? d?.chk_modifier ?? ''

      let active = true
      let numModFactor = 1

      const normName = normalize(name)
      const isDropdownControlled = dropdownMenus.some(dm => {
        const opts: string[] = dm?.selected_items ?? []
        return opts.some(opt => {
          const n = normalize(opt)
          return normName.includes(n) || n.includes(normName.slice(0, 15))
        })
      })

      if (isDropdownControlled) {
        active = Object.values(dropdownVals).some(val => {
          if (!val) return false
          const n = normalize(val)
          return normName.includes(n) || n.includes(normName.slice(0, 15))
        })
      } else {
        const modKind: string = d?.modifier?.kind ?? ''
        const modExpr: string = d?.modifier?.expression ?? ''
        if (modKind === 'formula' && modExpr) {
          const exprVars = { ...modVals, Width: widthInches, Height: heightInches }
          const exprVal = evalExpression(modExpr, exprVars)
          if (exprVal <= 0) {
            active = false
          } else {
            numModFactor = exprVal
          }
        } else {
          if (attachChk) {
            const chkVal = modVals[attachChk]
            active = chkVal === true || chkVal === 'true'
          }
          if (active && attachNum) {
            const numVal = parseFloat(String(modVals[attachNum] ?? 0))
            if (numVal <= 0) {
              active = false
            } else {
              numModFactor = numVal
            }
          }
        }
      }

      const perLiUnit: boolean = !!(d?.per_li_unit ?? d?.per_li ?? false)
      const typeLower = rawType.toLowerCase().replace('_', '')
      const isMat = typeLower === 'material'

      let totalCost = 0
      let totalPrice = 0
      let displayQty = 0
      let rateFound = false
      let breakdown: string[] | undefined

      if (isMat) {
        const mat = findMaterial(fullMaterialMap, name)
        rateFound = !!mat
        if (active && mat) {
          const res = computeMaterialLineItem(
            { cost: mat.cost, formula: mat.formula ?? itemFormula, fixed_side: mat.fixed_side, width: mat.width, height: mat.height, wastage_markup: mat.wastage_markup, calculate_wastage: mat.calculate_wastage },
            widthInches, heightInches, q, multiplier * numModFactor, perLiUnit,
          )
          totalCost = res.lineTotal
          totalPrice = mat.price > 0 && mat.cost > 0 ? res.lineTotal * (mat.price / mat.cost) : res.lineTotal
          displayQty = parseFloat(res.finalQty.toFixed(4))
          const bk: string[] = [`Print area: ${res.printArea.toFixed(2)} sqft × ${fmt(mat.cost)} = ${fmt(res.printArea * mat.cost)}`]
          if (res.wasteArea > 0) {
            bk.push(`Waste (${res.wasteStripInches.toFixed(0)}in strip): ${res.wasteArea.toFixed(2)} sqft × ${fmt(mat.cost)} × ${res.wastageMarkupPct}% = ${fmt(res.chargeableWaste * mat.cost)}`)
          }
          breakdown = bk
        } else {
          displayQty = multiplier * numModFactor * (perLiUnit ? q : 1)
        }
        lines.push({ name, itemType: rawType, formula: itemFormula, displayQty, unitCost: mat?.cost ?? 0, unitPrice: mat?.price ?? 0, totalCost, totalPrice, active, rateFound, isMaterial: true, breakdown })
      } else {
        const perPiece = computeFormula(itemFormula, widthFt, heightFt)
        const perPieceFormQty = perPiece * multiplier * numModFactor
        displayQty = active ? perPieceFormQty * q : perPiece * multiplier * q
        const rateMap =
          typeLower === 'laborrate' || typeLower === 'labor' ? laborMap
          : typeLower === 'machinerate' || typeLower === 'machine' ? machineMap
          : laborMap
        const rate = rateMap[name.trim().toLowerCase()]
        rateFound = !!rate
        if (active && rate) {
          const rateRec: RateRecord = {
            name: rate.name, cost: rate.cost, price: rate.price, markup: rate.markup,
            production_rate: rate.production_rate ?? undefined,
            setup_charge: rate.setup_charge ?? undefined,
            other_charge: rate.other_charge ?? undefined,
          }
          const result = computeLineItem(rateRec, perPieceFormQty, q)
          totalCost = result.totalCost
          totalPrice = result.totalPrice
          displayQty = result.displayQty * q
        }
        lines.push({ name, itemType: rawType, formula: itemFormula, displayQty, unitCost: rate?.cost ?? 0, unitPrice: rate?.price ?? 0, totalCost, totalPrice, active, rateFound, isMaterial: false })
      }
    }

    const gCost = lines.reduce((s, l) => s + l.totalCost, 0)
    const gPrice = lines.reduce((s, l) => s + l.totalPrice, 0)
    setResults(lines)
    setGrandTotalCost(gCost)
    setGrandTotalPrice(gPrice)
  }

  // ── guard clauses ─────────────────────────────────────────────
  if (!shopvoxData) {
    return (
      <div className="text-xs text-gray-400 italic py-6 text-center">
        No ShopVOX data available.
      </div>
    )
  }
  if (defaultItems.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic py-6 text-center">
        No default items found in ShopVOX data.
      </div>
    )
  }

  const overallMargin =
    grandTotalPrice > 0 ? ((grandTotalPrice - grandTotalCost) / grandTotalPrice) * 100 : 0

  const boolMods = modifiers.filter(m => {
    const t = (m?.type ?? m?.Type ?? '').toLowerCase()
    return t === 'boolean' || t === 'checkbox'
  })
  const nonBoolMods = modifiers.filter(m => {
    const t = (m?.type ?? m?.Type ?? '').toLowerCase()
    return t !== 'boolean' && t !== 'checkbox'
  })

  return (
    <div className="space-y-3 text-xs overflow-x-hidden">
      {/* 1. Header */}
      <div>
        <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
          ShopVOX Reference Pricing
        </p>
        <p className="text-[10px] text-gray-400 italic">
          Compare this to the PrintOS Builder on the right →
        </p>
      </div>

      {/* Rates status */}
      {ratesLoading && (
        <div className="flex items-center gap-2 text-gray-400 py-1">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gray-400 border-t-transparent" />
          Loading rates…
        </div>
      )}
      {ratesError && <p className="text-red-500">{ratesError}</p>}

      {/* 2. QTY input */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-500 font-medium">QTY</span>
        <input type="number" min={1} value={qty}
          onChange={e => setQty(parseInt(e.target.value)||1)}
          className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs" />
      </div>

      {/* 3. Modifiers (numeric grid) */}
      {nonBoolMods.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Modifiers</p>
          <div className="grid grid-cols-3 gap-2">
            {nonBoolMods.map((m, i) => {
              const name = m?.name ?? m?.Name ?? ''
              const type = (m?.type ?? m?.Type ?? '').toLowerCase()
              const isNumeric = type === 'numeric' || type === 'number'
              return (
                <div key={i}>
                  <label className="block truncate text-[10px] text-gray-500 mb-0.5" title={name}>{name}</label>
                  {isNumeric ? (
                    <input type="number" min={0} step={0.01}
                      value={typeof modVals[name] === 'number' ? modVals[name] : 0}
                      onChange={e => setModVals(p => ({ ...p, [name]: parseFloat(e.target.value) || 0 }))}
                      className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs" />
                  ) : (
                    <input type="text"
                      value={String(modVals[name] ?? '')}
                      onChange={e => setModVals(p => ({ ...p, [name]: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. Options (boolean checkboxes) */}
      {boolMods.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Options</p>
          {boolMods.map((m, i) => {
            const name = m?.name ?? m?.Name ?? ''
            const isOpt = m?.optional === true || m?.optional === 'true'
            return (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" checked={!!modVals[name]}
                  onChange={e => setModVals(p => ({ ...p, [name]: e.target.checked }))}
                  className="h-3 w-3 accent-green-500" />
                <label className="text-xs text-gray-700">{name}</label>
                {isOpt && <span className="text-[10px] text-gray-400">(optional)</span>}
              </div>
            )
          })}
        </div>
      )}

      {/* 5. Dropdown Selections */}
      {dropdownMenus.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-2">
          <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Dropdown Selections</p>
          {dropdownMenus.map((dm, i) => {
            const menuName = dm?.menu_name ?? dm?.['Menu Name'] ?? dm?.name ?? ''
            const items: string[] = dm?.selected_items ?? []
            const isOptional = !!dm?.optional
            if (!menuName) return null
            return (
              <div key={i}>
                <label className="block text-[10px] text-gray-500 uppercase">{menuName}</label>
                <select
                  className="w-full border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 mb-2"
                  value={dropdownVals[menuName] ?? (isOptional ? '' : (items[0] ?? ''))}
                  onChange={e => setDropdownVals(p => ({ ...p, [menuName]: e.target.value }))}
                >
                  {isOptional && <option value="">— None —</option>}
                  {items.map((item, j) => (
                    <option key={j} value={item}>{item}</option>
                  ))}
                </select>
              </div>
            )
          })}
        </div>
      )}

      {/* 6. Calculate button */}
      <button type="button" onClick={handleCalculate} disabled={!ratesReady}
        className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
        {ratesLoading ? 'Loading rates…' : 'Calculate Price'}
      </button>

      {/* 7. Results */}
      {results && (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500 max-w-[120px]">Item</th>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500">Type</th>
                  <th className="px-2 py-1.5 text-left font-medium uppercase tracking-wide text-gray-500">Formula</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Cost</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Total</th>
                  <th className="px-2 py-1.5 text-right font-medium uppercase tracking-wide text-gray-500">Sell</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {results.map((line, i) => (
                  <tr key={i} className={line.active ? '' : 'text-gray-300'}>
                    <td className="px-2 py-1.5 max-w-[120px]">
                      <span className={`truncate block ${!line.rateFound && line.active ? 'text-amber-600' : ''}`} title={line.name}>
                        {line.name}
                      </span>
                      {!line.rateFound && line.active && (
                        <span className="text-[9px] text-amber-500">rate not found</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap"><TypeBadge type={line.itemType} /></td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{line.formula}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{line.displayQty.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(line.unitCost)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {line.breakdown ? (
                        <div>
                          {line.breakdown.map((b, j) => (
                            <div key={j} className="text-[9px] text-gray-400 whitespace-nowrap text-left">{b}</div>
                          ))}
                          <div className="font-semibold">{fmt(line.totalCost)}</div>
                        </div>
                      ) : fmt(line.totalCost)}
                    </td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${line.active && line.totalPrice > 0 ? 'font-semibold text-green-700' : ''}`}>
                      {fmt(line.totalPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
            <span className="text-gray-600">
              Total Cost: <span className="font-semibold tabular-nums">{fmt(grandTotalCost)}</span>
            </span>
            <span className="font-bold text-green-700">
              Sell Price: <span className="tabular-nums">{fmt(grandTotalPrice)}</span>
            </span>
            <span className="font-bold text-green-700">
              Margin: <span className="tabular-nums">{overallMargin.toFixed(1)}%</span>
            </span>
          </div>

          <p className="text-[10px] text-gray-400">
            ● Active &nbsp; ○ Inactive &nbsp;
            <span className="text-amber-500">rate not found</span> = not in PrintOS yet
          </p>
        </div>
      )}
    </div>
  )
}
